// @ts-nocheck — RETAINED ONLY for `gpf_routes__1`, whose missing locals cannot be
// recovered from the queued payload (see the TODO(unresolved-f3-bug) on that case).
// Everything else in this file is now reconstructed and type-consistent; remove
// this banner as soon as the route-side fix described below lands.
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
 * All three cases closed over locals that exist only in the route file and are
 * NEVER defined here (`acctId`, `opening`, `acct`, `amount`, `delta`,
 * `entryType`, `ledgerId`, `ratePct`), so each threw
 * `ReferenceError: <x> is not defined`. Because the routes answer 201 as soon as
 * the message is queued, every GPF account opening, ledger posting and interest
 * accrual was a fake success: the caller saw 201 while nothing was written.
 *
 * ── Reconstruction rules used below ──
 *  - `id` (i.e. `p.id`) is the queued entity id, used as the PRIMARY KEY of the
 *    row a case inserts (the contract `disciplinary_routes__3` follows).
 *  - The employee is identified by the ROUTE PATH PARAM `params.id`; the
 *    generated `const id = p.id || params.id` above always resolves to `p.id`,
 *    which the stubbed routes fill with a throwaway `randomUUID()`.
 *  - `body` is the RAW pre-Zod request payload, so the route schema's
 *    `.default(...)` values are reapplied explicitly.
 *
 * KNOWN REMAINING DEFECT (route-side, out of scope for this file): the create
 * routes mint their own uuid, return it to the caller, then publish an unrelated
 * `randomUUID()`, so the id the caller receives is not the id persisted here.
 * Separately, `post()` and the interest route destructure balances off
 * `publishF3Write`'s return value, which only ever yields
 * `{ id, status, correlationId }` — so those responses report `undefined`
 * balances regardless of what this consumer computes.
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
            // TODO(unresolved-f3-bug): DELIBERATELY NOT RECONSTRUCTED — DO NOT GUESS.
            //
            // This single op is published by FOUR different routes that share the
            // `post(req, reply, entryType, sign)` helper in routes.ts:
            //     POST /v1/hrms/employees/:id/gpf/subscription  (entryType "subscription", sign +1)
            //     POST /v1/hrms/employees/:id/gpf/advance       (entryType "advance",      sign -1)
            //     POST /v1/hrms/employees/:id/gpf/withdrawal    (entryType "withdrawal",   sign -1)
            //     POST /v1/hrms/employees/:id/gpf/refund        (entryType "refund",       sign +1)
            //
            // `entryType` and `sign` are ARGUMENTS to that helper, not request
            // data. The generated publish call forwards only { body, params,
            // query }, all four of which are byte-identical across the four
            // routes, so the queued message carries NO information about which
            // route produced it. `entryType` and the credit/debit sign are
            // therefore unrecoverable inside this consumer.
            //
            // Guessing is not acceptable here: picking the wrong sign would
            // CREDIT a member's GPF where the request was a withdrawal (or debit
            // a subscription), silently corrupting a statutory provident-fund
            // ledger and its running balance. Leaving the ReferenceError in place
            // keeps this op loudly broken instead of quietly wrong.
            //
            // FIX (route-side, one line in gpf/routes.ts — outside this batch's
            // scope): forward the discriminator, e.g.
            //     await publishF3Write(ctx, "gpf_routes__1", ledgerId, {
            //       body: ..., params: ..., query: ..., entryType, sign,
            //     });
            // then this case becomes:
            //     const employeeId = String(params.id ?? "");
            //     const acct = await repo.findAccountByEmployee(p.tenantId, employeeId);
            //     if (!acct) throw new HttpError(404, "NO_GPF_ACCOUNT", "employee has no GPF account");
            //     const entryType = String(p.entryType);
            //     const amount = BigInt(body.amountMinor);
            //     const delta = p.sign === 1 ? amount : -amount;
            //     const ledgerId = id;
            //     ...existing body below...
            const prevBal = await repo.lockedBalance(tx, p.tenantId, acct);
                  const nextBal = prevBal + delta;
                  if (nextBal < 0n) throw new HttpError(409, "INSUFFICIENT_BALANCE", "debit exceeds available GPF balance");
                  await repo.insertLedger(tx, {
                    id: ledgerId, tenantId: p.tenantId, accountId: acct.id, employeeId: id,
                    entryType, amountMinor: amount, deltaMinor: delta, balanceMinor: nextBal,
                    ...(body.narrative !== undefined ? { narrative: body.narrative } : {}),
                    ...(body.effectiveDate !== undefined ? { effectiveDate: body.effectiveDate } : {}),
                    createdBy: msg.actorId,
                  });
                  // L4: bump the account optimistic-lock version on every ledger mutation.
                  await repo.bumpAccountVersion(tx, p.tenantId, acct.id, msg.actorId, acct.version);
                  return { prev: prevBal, next: nextBal };
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
