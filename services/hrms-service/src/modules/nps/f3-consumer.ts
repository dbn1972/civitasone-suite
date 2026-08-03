import type { Queue } from "@civitasone/queue";
import { pino } from "pino";
import { and, eq, desc, asc, sql, inArray, isNull, isNotNull, ne, or, gt, lt, gte, lte } from "drizzle-orm";
import { db } from "../../shared/db.js";
import { enqueue, markProcessed } from "../../shared/outbox.js";
import { COMMANDS } from "../../topics.js";
import { hrmsEmployees } from "../employee/schema.js";
import * as repo from "./repo.js";
const log = pino({ name: "hrms-f3-nps" });
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
    try {
      await db.transaction(async (tx) => {
        if (!(await markProcessed(tx, msg.messageId))) return;
        switch (op) {
          case "nps_routes__0": {
            await repo.insertAccount(tx, {
                      id: acctId, tenantId: p.tenantId, employeeId: id, pran: body.pran, tier: body.tier,
                      openingEmpMinor: openEmp, openingErMinor: openEr,
                      empContribPct: String(body.empContribPct), erContribPct: String(body.erContribPct),
                      createdBy: msg.actorId, updatedBy: msg.actorId,
                    });
                    if (openEmp > 0n || openEr > 0n) {
                      await repo.insertContribution(tx, {
                        id: randomUUID(), tenantId: p.tenantId, accountId: acctId, employeeId: id,
                        entryType: "opening", empAmountMinor: openEmp, erAmountMinor: openEr,
                        deltaMinor: openEmp + openEr, empBalanceMinor: openEmp, erBalanceMinor: openEr,
                        balanceMinor: openEmp + openEr, narrative: "opening balance", createdBy: msg.actorId,
                      });
                    }
            break;
          }
          case "nps_routes__1": {
            const prevBal = await repo.lockedBalance(tx, p.tenantId, acct);
                    const nextBal = {
                      emp: prevBal.emp + empAmt, er: prevBal.er + erAmt, total: prevBal.total + empAmt + erAmt,
                    };
                    await repo.insertContribution(tx, {
                      id: ledgerId, tenantId: p.tenantId, accountId: acct.id, employeeId: id,
                      entryType: "contribution", period: body.period, empAmountMinor: empAmt, erAmountMinor: erAmt,
                      deltaMinor: empAmt + erAmt, empBalanceMinor: nextBal.emp, erBalanceMinor: nextBal.er,
                      balanceMinor: nextBal.total,
                      ...(body.narrative !== undefined ? { narrative: body.narrative } : {}),
                      ...(body.effectiveDate !== undefined ? { effectiveDate: body.effectiveDate } : {}),
                      createdBy: msg.actorId,
                    });
                    await repo.bumpAccountVersion(tx, p.tenantId, acct.id, msg.actorId, acct.version);
                    return { prev: prevBal, next: nextBal };
            break;
          }
          case "nps_routes__2": {
            const prevBal = await repo.lockedBalance(tx, p.tenantId, acct);
                  if (prevBal.total - amount < 0n) throw new HttpError(409, "INSUFFICIENT_BALANCE", "withdrawal exceeds NPS corpus");
                  // Draw down the employer leg first, then the employee leg (both stay >= 0).
                  const erDraw = amount <= prevBal.er ? amount : prevBal.er;
                  const empDraw = amount - erDraw;
                  const nextBal = { emp: prevBal.emp - empDraw, er: prevBal.er - erDraw, total: prevBal.total - amount };
                  await repo.insertContribution(tx, {
                    id: ledgerId, tenantId: p.tenantId, accountId: acct.id, employeeId: id,
                    entryType: "withdrawal", empAmountMinor: empDraw, erAmountMinor: erDraw,
                    deltaMinor: -amount, empBalanceMinor: nextBal.emp, erBalanceMinor: nextBal.er, balanceMinor: nextBal.total,
                    ...(body.narrative !== undefined ? { narrative: body.narrative } : {}),
                    ...(body.effectiveDate !== undefined ? { effectiveDate: body.effectiveDate } : {}),
                    createdBy: msg.actorId,
                  });
                  await repo.bumpAccountVersion(tx, p.tenantId, acct.id, msg.actorId, acct.version);
                  return { prev: prevBal, next: nextBal };
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
