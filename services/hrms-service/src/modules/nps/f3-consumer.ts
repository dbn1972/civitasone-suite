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
const log = pino({ name: "hrms-f3-nps" });
/**
 * HR-A deep-verify fix (F3 batch 5). The F3 code-gen lifted each route's WRITE
 * into the switch below but dropped the preamble that resolved the account and
 * the amounts. Every case referenced locals (`acctId`, `openEmp`, `openEr`,
 * `acct`, `empAmt`, `erAmt`, `amount`, `ledgerId`) declared nowhere in this
 * file, so each threw a ReferenceError on first use. The route has already
 * replied by then — the write is fire-and-forget through the queue — so PRAN
 * enrolment, every monthly contribution and every withdrawal was a FAKE
 * SUCCESS: nothing ever reached hrms_nps_accounts / hrms_nps_contributions.
 *
 * The preambles are restored below, mirroring routes.ts. `body` is the RAW
 * pre-Zod body forwarded through the queue, so each `.default(...)` is applied
 * explicitly. The employee id comes from `params.id` (what routes.ts parsed
 * with `idParam`): routes.ts publishes a fresh randomUUID as the message id, so
 * the top-level `id` identifies the MESSAGE, not the employee — using it as
 * `employeeId` (as the generated code did) would have written orphan rows even
 * if the ReferenceErrors had not fired first.
 */
export function registerF3_nps_Consumers(queue: Queue): void {
  queue.subscribe(COMMANDS.f3RouteWrite, async (msg) => {
    const p = msg.payload as Record<string, any>;
    const op = String(p.op ?? "");
    const ops = new Set([
      "nps_routes__0",
      "nps_routes__1",
      "nps_routes__2",
    ]);
    if (!ops.has(op)) return;
    const body = p.body ?? {};
    const params = p.params ?? {};
    const id = (p.id as string) || (params.id as string);
    /** The employee the route addressed (`/v1/hrms/employees/:id/nps`). */
    const employeeId = (params.id as string) || id;
    try {
      await db.transaction(async (tx) => {
        if (!(await markProcessed(tx, msg.messageId))) return;
        switch (op) {
          case "nps_routes__0": {
            // Restored: the new account's id and the opening balances.
            const acctId = id;
            const openEmp = BigInt(body.openingEmpMinor ?? 0);
            const openEr = BigInt(body.openingErMinor ?? 0);
            await repo.insertAccount(tx, {
                      id: acctId, tenantId: p.tenantId, employeeId, pran: body.pran, tier: body.tier ?? "I",
                      openingEmpMinor: openEmp, openingErMinor: openEr,
                      empContribPct: String(body.empContribPct ?? 10), erContribPct: String(body.erContribPct ?? 14),
                      createdBy: msg.actorId, updatedBy: msg.actorId,
                    });
                    if (openEmp > 0n || openEr > 0n) {
                      await repo.insertContribution(tx, {
                        id: randomUUID(), tenantId: p.tenantId, accountId: acctId, employeeId,
                        entryType: "opening", empAmountMinor: openEmp, erAmountMinor: openEr,
                        deltaMinor: openEmp + openEr, empBalanceMinor: openEmp, erBalanceMinor: openEr,
                        balanceMinor: openEmp + openEr, narrative: "opening balance", createdBy: msg.actorId,
                      });
                    }
            break;
          }
          case "nps_routes__1": {
            // Restored: `acct` (mustAccount), the two contribution legs, and the
            // new ledger row's id.
            const acct = await repo.findAccountByEmployee(p.tenantId, employeeId);
            if (!acct) throw new HttpError(404, "NO_NPS_ACCOUNT", "employee has no NPS account");
            const empAmt = BigInt(body.empAmountMinor ?? 0);
            const erAmt = BigInt(body.erAmountMinor ?? 0);
            const ledgerId = randomUUID();
            const prevBal = await repo.lockedBalance(tx, p.tenantId, acct);
                    const nextBal = {
                      emp: prevBal.emp + empAmt, er: prevBal.er + erAmt, total: prevBal.total + empAmt + erAmt,
                    };
                    await repo.insertContribution(tx, {
                      id: ledgerId, tenantId: p.tenantId, accountId: acct.id, employeeId,
                      entryType: "contribution", period: body.period, empAmountMinor: empAmt, erAmountMinor: erAmt,
                      deltaMinor: empAmt + erAmt, empBalanceMinor: nextBal.emp, erBalanceMinor: nextBal.er,
                      balanceMinor: nextBal.total,
                      ...(body.narrative !== undefined ? { narrative: body.narrative } : {}),
                      ...(body.effectiveDate !== undefined ? { effectiveDate: body.effectiveDate } : {}),
                      createdBy: msg.actorId,
                    });
                    await repo.bumpAccountVersion(tx, p.tenantId, acct.id, msg.actorId, acct.version);
            break;
          }
          case "nps_routes__2": {
            // Restored: `acct` (mustAccount), the withdrawal `amount` and the
            // new ledger row's id. The overdraft guard is kept — unlike the
            // route's pre-publish state checks it depends on the balance read
            // under the advisory lock HERE, so it cannot be delegated upstream.
            const acct = await repo.findAccountByEmployee(p.tenantId, employeeId);
            if (!acct) throw new HttpError(404, "NO_NPS_ACCOUNT", "employee has no NPS account");
            const amount = BigInt(body.amountMinor);
            const ledgerId = randomUUID();
            const prevBal = await repo.lockedBalance(tx, p.tenantId, acct);
                  if (prevBal.total - amount < 0n) throw new HttpError(409, "INSUFFICIENT_BALANCE", "withdrawal exceeds NPS corpus");
                  // Draw down the employer leg first, then the employee leg (both stay >= 0).
                  const erDraw = amount <= prevBal.er ? amount : prevBal.er;
                  const empDraw = amount - erDraw;
                  const nextBal = { emp: prevBal.emp - empDraw, er: prevBal.er - erDraw, total: prevBal.total - amount };
                  await repo.insertContribution(tx, {
                    id: ledgerId, tenantId: p.tenantId, accountId: acct.id, employeeId,
                    entryType: "withdrawal", empAmountMinor: empDraw, erAmountMinor: erDraw,
                    deltaMinor: -amount, empBalanceMinor: nextBal.emp, erBalanceMinor: nextBal.er, balanceMinor: nextBal.total,
                    ...(body.narrative !== undefined ? { narrative: body.narrative } : {}),
                    ...(body.effectiveDate !== undefined ? { effectiveDate: body.effectiveDate } : {}),
                    createdBy: msg.actorId,
                  });
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
