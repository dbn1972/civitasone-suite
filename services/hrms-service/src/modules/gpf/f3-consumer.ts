import type { Queue } from "@civitasone/queue";
import { pino } from "pino";
import { and, eq, desc, asc, sql, inArray, isNull, isNotNull, ne, or, gt, lt, gte, lte } from "drizzle-orm";
import { db } from "../../shared/db.js";
import { enqueue, markProcessed } from "../../shared/outbox.js";
import { COMMANDS } from "../../topics.js";
import { hrmsEmployees } from "../employee/schema.js";
import * as repo from "./repo.js";
const log = pino({ name: "hrms-f3-gpf" });
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
            await repo.insertAccount(tx, {
                    id: acctId, tenantId: p.tenantId, employeeId: id, gpfNumber: body.gpfNumber,
                    openingBalanceMinor: opening,
                    monthlySubscriptionMinor: BigInt(body.monthlySubscriptionMinor),
                    interestRatePct: String(body.interestRatePct),
                    createdBy: msg.actorId, updatedBy: msg.actorId,
                  });
                  if (opening > 0n) {
                    await repo.insertLedger(tx, {
                      id: randomUUID(), tenantId: p.tenantId, accountId: acctId, employeeId: id,
                      entryType: "opening", amountMinor: opening, deltaMinor: opening, balanceMinor: opening,
                      narrative: "opening balance", createdBy: msg.actorId,
                    });
                  }
            break;
          }
          case "gpf_routes__1": {
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
            const prevBal = await repo.lockedBalance(tx, p.tenantId, acct);
                  // paise * rate% * months/12, rounded to nearest paise
                  const interestMinor = BigInt(Math.round(Number(prevBal) * (ratePct / 100) * (body.months / 12)));
                  const nextBal = prevBal + interestMinor;
                  await repo.insertLedger(tx, {
                    id: ledgerId, tenantId: p.tenantId, accountId: acct.id, employeeId: id,
                    entryType: "interest", amountMinor: interestMinor, deltaMinor: interestMinor, balanceMinor: nextBal,
                    narrative: `interest @ ${ratePct}% for ${body.months} month(s)`, createdBy: msg.actorId,
                  });
                  // L4: bump the account optimistic-lock version on interest accrual too.
                  await repo.bumpAccountVersion(tx, p.tenantId, acct.id, msg.actorId, acct.version);
                  return { prev: prevBal, interest: interestMinor, next: nextBal };
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
