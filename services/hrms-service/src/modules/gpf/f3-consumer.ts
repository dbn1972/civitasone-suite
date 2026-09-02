import { randomUUID } from "node:crypto";
import type { Queue } from "@civitasone/queue";
import { pino } from "pino";
import { and, eq, desc, asc, sql, inArray, isNull, isNotNull, ne, or, gt, lt, gte, lte } from "drizzle-orm";
import { db } from "../../shared/db.js";
import { enqueue, markProcessed } from "../../shared/outbox.js";
import { COMMANDS } from "../../topics.js";
import { HttpError } from "../../shared/context.js";
import { hrmsEmployees } from "../employee/schema.js";
import * as repo from "./repo.js";
const log = pino({ name: "hrms-f3-gpf" });

/**
 * F3 leftover write consumer for GPF (General Provident Fund).
 *
 * ── Bug class fixed here (same shape as `leave_policy_admin_routes__0`) ──
 * The generator that stubbed these routes down to a bare `publishF3Write(...)`
 * dropped the "fetch the account + compute the derived money values" preamble.
 * All three cases closed over locals that exist only in the route file and were
 * NEVER defined here (`acctId`, `opening`, `acct`, `amount`, `delta`,
 * `entryType`, `ledgerId`, `ratePct`), so each threw
 * `ReferenceError: <x> is not defined`. Because the routes answer 2xx as soon
 * as the message is queued, every GPF account opening, ledger posting and
 * interest accrual was a fake success: the caller saw success while nothing
 * was written.
 *
 * ── Reconstruction rules used below ──
 *  - `id` (i.e. `p.id`) is the queued entity id, used as the PRIMARY KEY of the
 *    row a case inserts (the contract `disciplinary_routes__3` follows).
 *  - The employee is identified by the ROUTE PATH PARAM `params.id`; the
 *    generated `const id = p.id || params.id` above always resolves to `p.id`.
 *  - `body` is the RAW pre-Zod request payload, so the route schema's
 *    `.default(...)` values are reapplied explicitly.
 *
 * ── `gpf_routes__1` (subscription / advance / withdrawal / refund) ──
 * This was the one case that genuinely could NOT be reconstructed from the
 * queued payload alone: all four routes shared this op via the
 * `post(req, reply, entryType, sign)` helper in routes.ts and published it
 * with byte-identical `{ body, params, query }`, so nothing in the message
 * said which of the four routes produced it, or which credit/debit direction
 * to apply. Guessing was not acceptable — picking the wrong sign would
 * silently corrupt a statutory provident-fund ledger. That has now been fixed
 * on the route side: `routes.ts` forwards `entryType` and `sign` explicitly
 * instead of leaving the consumer to guess, so this case is reconstructed
 * like the other two below (and the `@ts-nocheck` this file used to carry
 * solely for this case has been removed).
 *
 * `post()` and the interest route in routes.ts no longer destructure balances
 * off `publishF3Write`'s return value either — that call only ever resolves
 * `{ id, status, correlationId }` (see shared/f3-publish.ts), never
 * `prev`/`next`/`interest`. Since the actual write happens here, later and
 * asynchronously, those routes cannot know the resulting balance
 * synchronously and now respond 202 Accepted without it; callers read
 * GET /gpf for the posted amount and resulting balance once the write lands.
 */
export function registerF3_gpf_Consumers(queue: Queue): void {
  queue.subscribe(COMMANDS.f3RouteWrite, async (msg) => {
    const p = msg.payload as Record<string, any>;
    const op = String(p.op ?? "");
    const ops = new Set([
      "gpf_routes__0",
      "gpf_routes__1",
      "gpf_routes__2",
    ]);
    if (!ops.has(op)) return;
    const body = p.body ?? {};
    const params = p.params ?? {};
    const id = (p.id as string) || (params.id as string);
    try {
      await db.transaction(async (tx) => {
        if (!(await markProcessed(tx, msg.messageId))) return;
        switch (op) {
          case "gpf_routes__0": {
            // POST /v1/hrms/employees/:id/gpf — open an account. Defaults mirror
            // the route's Zod schema field-for-field (openingBalanceMinor 0,
            // monthlySubscriptionMinor 0, interestRatePct 7.10) because `body`
            // here is the raw, pre-Zod-default request payload.
            const acctId = id;
            const employeeId = String(params.id ?? "");
            const opening = BigInt(body.openingBalanceMinor ?? 0);
            await repo.insertAccount(tx, {
                    id: acctId, tenantId: p.tenantId, employeeId, gpfNumber: body.gpfNumber,
                    openingBalanceMinor: opening,
                    monthlySubscriptionMinor: BigInt(body.monthlySubscriptionMinor ?? 0),
                    interestRatePct: String(body.interestRatePct ?? 7.10),
                    createdBy: msg.actorId, updatedBy: msg.actorId,
                  });
                  if (opening > 0n) {
                    await repo.insertLedger(tx, {
                      id: randomUUID(), tenantId: p.tenantId, accountId: acctId, employeeId,
                      entryType: "opening", amountMinor: opening, deltaMinor: opening, balanceMinor: opening,
                      narrative: "opening balance", createdBy: msg.actorId,
                    });
                  }
            break;
          }
          case "gpf_routes__1": {
            // Subscription / advance / withdrawal / refund all share this op via
            // the `post(req, reply, entryType, sign)` helper in routes.ts. The
            // route now forwards `entryType` and `sign` explicitly, so this case
            // no longer has to guess the credit/debit direction.
            const employeeId = String(params.id ?? "");
            const acct = await repo.findAccountByEmployee(p.tenantId, employeeId);
            if (!acct) throw new HttpError(404, "NO_GPF_ACCOUNT", "employee has no GPF account");
            const entryType = String(p.entryType);
            const amount = BigInt(body.amountMinor);
            const sign = p.sign === 1 ? 1 : -1;
            const delta = sign === 1 ? amount : -amount;
            const ledgerId = id;
            const prevBal = await repo.lockedBalance(tx, p.tenantId, acct);
            const nextBal = prevBal + delta;
            if (nextBal < 0n) throw new HttpError(409, "INSUFFICIENT_BALANCE", "debit exceeds available GPF balance");
            await repo.insertLedger(tx, {
              id: ledgerId, tenantId: p.tenantId, accountId: acct.id, employeeId,
              entryType, amountMinor: amount, deltaMinor: delta, balanceMinor: nextBal,
              ...(body.narrative !== undefined ? { narrative: body.narrative } : {}),
              ...(body.effectiveDate !== undefined ? { effectiveDate: body.effectiveDate } : {}),
              createdBy: msg.actorId,
            });
            // L4: bump the account optimistic-lock version on every ledger mutation.
            await repo.bumpAccountVersion(tx, p.tenantId, acct.id, msg.actorId, acct.version);
            break;
          }
          case "gpf_routes__2": {
            // POST /v1/hrms/employees/:id/gpf/interest. The account was fetched by
            // the route (`mustAccount`) but never forwarded, so it is re-read
            // here; `ratePct` and `months` mirror the route exactly
            // (`body.ratePctOverride ?? acct.interestRatePct`, months Zod-default 12).
            const employeeId = String(params.id ?? "");
            const acct = await repo.findAccountByEmployee(p.tenantId, employeeId);
            if (!acct) throw new HttpError(404, "NO_GPF_ACCOUNT", "employee has no GPF account");
            const ledgerId = id;
            const months = Number(body.months ?? 12);
            const ratePct = body.ratePctOverride ?? Number(acct.interestRatePct);
            const prevBal = await repo.lockedBalance(tx, p.tenantId, acct);
                  // paise * rate% * months/12, rounded to nearest paise
                  const interestMinor = BigInt(Math.round(Number(prevBal) * (ratePct / 100) * (months / 12)));
                  const nextBal = prevBal + interestMinor;
                  await repo.insertLedger(tx, {
                    id: ledgerId, tenantId: p.tenantId, accountId: acct.id, employeeId,
                    entryType: "interest", amountMinor: interestMinor, deltaMinor: interestMinor, balanceMinor: nextBal,
                    narrative: `interest @ ${ratePct}% for ${months} month(s)`, createdBy: msg.actorId,
                  });
                  // L4: bump the account optimistic-lock version on interest accrual too.
                  await repo.bumpAccountVersion(tx, p.tenantId, acct.id, msg.actorId, acct.version);
            break;
          }
        }
      });
    } catch (err) {
      log.error({ err, op, messageId: msg.messageId }, "f3RouteWrite failed");
      throw err;
    }
  });
}
