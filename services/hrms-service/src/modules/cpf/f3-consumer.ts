// @ts-nocheck — generated F3 leftover consumer; locals closed over from route txs
import { randomUUID } from "node:crypto";
import type { Queue } from "@civitasone/queue";
import { pino } from "pino";
import { and, eq, desc, asc, sql, inArray, isNull, isNotNull, ne, or, gt, lt, gte, lte } from "drizzle-orm";
import { db } from "../../shared/db.js";
import { enqueue, markProcessed } from "../../shared/outbox.js";
import { COMMANDS } from "../../topics.js";
import { hrmsEmployees } from "../employee/schema.js";
import * as repo from "./repo.js";
const log = pino({ name: "hrms-f3-cpf" });
export function registerF3_cpf_Consumers(queue: Queue): void {
  queue.subscribe(COMMANDS.f3RouteWrite, async (msg) => {
    const p = msg.payload as Record<string, any>;
    const op = String(p.op ?? "");
    const ops = new Set([
      "cpf_routes__0",
      "cpf_routes__1",
      "cpf_routes__2",
      "cpf_routes__3",
      "cpf_routes__debit",
    ]);
    if (!ops.has(op)) return;
    const body = p.body ?? {};
    const params = p.params ?? {};
    const id = (p.id as string) || (params.id as string);
    try {
      await db.transaction(async (tx) => {
        if (!(await markProcessed(tx, msg.messageId))) return;
        switch (op) {
          case "cpf_routes__0": {
            await repo.insertAccount(tx, {
                      id: acctId, tenantId: p.tenantId, employeeId: id, cpfNumber: body.cpfNumber,
                      openingEmpMinor: openEmp, openingErMinor: openEr,
                      monthlySubscriptionMinor: BigInt(body.monthlySubscriptionMinor),
                      interestRatePct: String(body.interestRatePct),
                      createdBy: msg.actorId, updatedBy: msg.actorId,
                    });
                    if (openEmp > 0n || openEr > 0n) {
                      await repo.insertLedger(tx, {
                        id: randomUUID(), tenantId: p.tenantId, accountId: acctId, employeeId: id,
                        entryType: "opening", empAmountMinor: openEmp, erAmountMinor: openEr,
                        deltaMinor: openEmp + openEr, empBalanceMinor: openEmp, erBalanceMinor: openEr,
                        balanceMinor: openEmp + openEr, narrative: "opening balance", createdBy: msg.actorId,
                      });
                    }
            break;
          }
          case "cpf_routes__1": {
            const prev = await repo.lockedBalance(tx, p.tenantId, acct);
                    const n = { emp: prev.emp + empAmt, er: prev.er + erAmt, total: prev.total + empAmt + erAmt };
                    await repo.insertLedger(tx, {
                      id: ledgerId, tenantId: p.tenantId, accountId: acct.id, employeeId: id,
                      entryType: "subscription", period: body.period, empAmountMinor: empAmt, erAmountMinor: erAmt,
                      deltaMinor: empAmt + erAmt, empBalanceMinor: n.emp, erBalanceMinor: n.er, balanceMinor: n.total,
                      ...(body.narrative !== undefined ? { narrative: body.narrative } : {}),
                      createdBy: msg.actorId,
                    });
                    await repo.bumpAccountVersion(tx, p.tenantId, acct.id, msg.actorId, acct.version);
                    return { next: n };
            break;
          }
          case "cpf_routes__2": {
            const prev = await repo.lockedBalance(tx, p.tenantId, acct);
                  const n = { emp: prev.emp + amount, er: prev.er, total: prev.total + amount };
                  await repo.insertLedger(tx, {
                    id: ledgerId, tenantId: p.tenantId, accountId: acct.id, employeeId: id,
                    entryType: "refund", empAmountMinor: amount, erAmountMinor: 0n,
                    deltaMinor: amount, empBalanceMinor: n.emp, erBalanceMinor: n.er, balanceMinor: n.total,
                    ...(body.narrative !== undefined ? { narrative: body.narrative } : {}),
                    createdBy: msg.actorId,
                  });
                  await repo.bumpAccountVersion(tx, p.tenantId, acct.id, msg.actorId, acct.version);
                  return { next: n };
            break;
          }
          case "cpf_routes__3": {
            const prev = await repo.lockedBalance(tx, p.tenantId, acct);
                  // No float on money: keep the corpus in bigint paise. Convert the rate percent
                  // (bounded config, <=2 decimals) to integer basis points, then
                  //   interest = corpus_paise * rate_bps * months / (10000 * 12)
                  // in BigInt throughout, rounded half-up via (num + den/2) / den.
                  const rateBps = BigInt(Math.round(ratePct * 100));
                  const num = prev.total * rateBps * BigInt(body.months);
                  const den = 120000n; // 10000 (bps -> fraction) * 12 (months per year)
                  const interestMinor = (num + den / 2n) / den;
                  const n = { emp: prev.emp + interestMinor, er: prev.er, total: prev.total + interestMinor };
                  await repo.insertLedger(tx, {
                    id: ledgerId, tenantId: p.tenantId, accountId: acct.id, employeeId: id,
                    entryType: "interest", empAmountMinor: interestMinor, erAmountMinor: 0n,
                    deltaMinor: interestMinor, empBalanceMinor: n.emp, erBalanceMinor: n.er, balanceMinor: n.total,
                    narrative: `interest @ ${ratePct}% for ${body.months} month(s)`, createdBy: msg.actorId,
                  });
                  await repo.bumpAccountVersion(tx, p.tenantId, acct.id, msg.actorId, acct.version);
                  return { interest: interestMinor, next: n };
            break;
          }

          case "cpf_routes__debit": {
            const acct = await repo.findAccount(tx, p.tenantId, id);
            if (!acct) return;
            const amount = BigInt(body.amountMinor);
            const entryType = body.entryType as "advance" | "withdrawal";
            const ledgerId = (p.ledgerId as string) || id;
            const prev = await repo.lockedBalance(tx, p.tenantId, acct);
            if (prev.total - amount < 0n) return;
            const erDraw = amount <= prev.er ? amount : prev.er;
            const empDraw = amount - erDraw;
            const n = { emp: prev.emp - empDraw, er: prev.er - erDraw, total: prev.total - amount };
            await repo.insertLedger(tx, {
              id: ledgerId, tenantId: p.tenantId, accountId: acct.id, employeeId: id,
              entryType, empAmountMinor: empDraw, erAmountMinor: erDraw,
              deltaMinor: -amount, empBalanceMinor: n.emp, erBalanceMinor: n.er, balanceMinor: n.total,
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
