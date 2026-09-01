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
const log = pino({ name: "hrms-f3-cpf" });
/**
 * HR-A deep-verify fix (F3 batch 5). The F3 code-gen lifted each route's WRITE
 * into the switch below but dropped the preamble that resolved the account and
 * the amounts. Cases __0..__3 referenced locals (`acctId`, `openEmp`, `openEr`,
 * `acct`, `empAmt`, `erAmt`, `amount`, `ratePct`, `ledgerId`) declared nowhere
 * in this file, so each threw a ReferenceError on first use. The route has
 * already replied by then — the write is fire-and-forget through the queue — so
 * opening an account, every monthly subscription, every refund and every
 * interest accrual was a FAKE SUCCESS: nothing reached hrms_cpf_accounts /
 * hrms_cpf_ledger.
 *
 * `cpf_routes__debit` was hand-written rather than generated and so escaped the
 * ReferenceErrors, but carried two faults of its own, both fixed below:
 *   - it called `repo.findAccount(tx, ...)`, which does not exist (the real
 *     helper is `findAccountByEmployee(tenantId, employeeId)`), so every
 *     advance and withdrawal threw TypeError;
 *   - it derived the ledger row's primary key from the EMPLOYEE id, so a second
 *     advance/withdrawal for the same employee would collide on the PK.
 *
 * `body` is the RAW pre-Zod body forwarded through the queue, so each
 * `.default(...)` is applied explicitly. The employee id comes from `params.id`
 * (what routes.ts parsed with `idParam`): __0 and __1 publish a fresh randomUUID
 * as the message id, so the top-level `id` identifies the MESSAGE there, not the
 * employee.
 */
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
    /** The employee the route addressed (`/v1/hrms/employees/:id/cpf...`). */
    const employeeId = (params.id as string) || id;
    try {
      await db.transaction(async (tx) => {
        if (!(await markProcessed(tx, msg.messageId))) return;
        switch (op) {
          case "cpf_routes__0": {
            // Restored: the new account's id and the opening balances.
            const acctId = id;
            const openEmp = BigInt(body.openingEmpMinor ?? 0);
            const openEr = BigInt(body.openingErMinor ?? 0);
            await repo.insertAccount(tx, {
                      id: acctId, tenantId: p.tenantId, employeeId, cpfNumber: body.cpfNumber,
                      openingEmpMinor: openEmp, openingErMinor: openEr,
                      monthlySubscriptionMinor: BigInt(body.monthlySubscriptionMinor ?? 0),
                      interestRatePct: String(body.interestRatePct ?? 7.10),
                      createdBy: msg.actorId, updatedBy: msg.actorId,
                    });
                    if (openEmp > 0n || openEr > 0n) {
                      await repo.insertLedger(tx, {
                        id: randomUUID(), tenantId: p.tenantId, accountId: acctId, employeeId,
                        entryType: "opening", empAmountMinor: openEmp, erAmountMinor: openEr,
                        deltaMinor: openEmp + openEr, empBalanceMinor: openEmp, erBalanceMinor: openEr,
                        balanceMinor: openEmp + openEr, narrative: "opening balance", createdBy: msg.actorId,
                      });
                    }
            break;
          }
          case "cpf_routes__1": {
            // Restored: `acct` (mustAccount), the two subscription legs, and the
            // new ledger row's id.
            const acct = await repo.findAccountByEmployee(p.tenantId, employeeId);
            if (!acct) throw new HttpError(404, "NO_CPF_ACCOUNT", "employee has no CPF account");
            const empAmt = BigInt(body.empAmountMinor ?? 0);
            const erAmt = BigInt(body.erAmountMinor ?? 0);
            const ledgerId = randomUUID();
            const prev = await repo.lockedBalance(tx, p.tenantId, acct);
                    const n = { emp: prev.emp + empAmt, er: prev.er + erAmt, total: prev.total + empAmt + erAmt };
                    await repo.insertLedger(tx, {
                      id: ledgerId, tenantId: p.tenantId, accountId: acct.id, employeeId,
                      entryType: "subscription", period: body.period, empAmountMinor: empAmt, erAmountMinor: erAmt,
                      deltaMinor: empAmt + erAmt, empBalanceMinor: n.emp, erBalanceMinor: n.er, balanceMinor: n.total,
                      ...(body.narrative !== undefined ? { narrative: body.narrative } : {}),
                      createdBy: msg.actorId,
                    });
                    await repo.bumpAccountVersion(tx, p.tenantId, acct.id, msg.actorId, acct.version);
            break;
          }
          case "cpf_routes__2": {
            // Restored: `acct` (mustAccount), the refund `amount` and the new
            // ledger row's id. A refund credits the EMPLOYEE leg only.
            const acct = await repo.findAccountByEmployee(p.tenantId, employeeId);
            if (!acct) throw new HttpError(404, "NO_CPF_ACCOUNT", "employee has no CPF account");
            const amount = BigInt(body.amountMinor);
            const ledgerId = randomUUID();
            const prev = await repo.lockedBalance(tx, p.tenantId, acct);
                  const n = { emp: prev.emp + amount, er: prev.er, total: prev.total + amount };
                  await repo.insertLedger(tx, {
                    id: ledgerId, tenantId: p.tenantId, accountId: acct.id, employeeId,
                    entryType: "refund", empAmountMinor: amount, erAmountMinor: 0n,
                    deltaMinor: amount, empBalanceMinor: n.emp, erBalanceMinor: n.er, balanceMinor: n.total,
                    ...(body.narrative !== undefined ? { narrative: body.narrative } : {}),
                    createdBy: msg.actorId,
                  });
                  await repo.bumpAccountVersion(tx, p.tenantId, acct.id, msg.actorId, acct.version);
            break;
          }
          case "cpf_routes__3": {
            // Restored: `acct` (mustAccount), `ratePct` — the override if the
            // caller supplied one, else the account's own configured rate — the
            // month count, and the new ledger row's id.
            const acct = await repo.findAccountByEmployee(p.tenantId, employeeId);
            if (!acct) throw new HttpError(404, "NO_CPF_ACCOUNT", "employee has no CPF account");
            const ratePct = Number(body.ratePctOverride ?? acct.interestRatePct);
            const months = Number(body.months ?? 12);
            const ledgerId = randomUUID();
            const prev = await repo.lockedBalance(tx, p.tenantId, acct);
                  // No float on money: keep the corpus in bigint paise. Convert the rate percent
                  // (bounded config, <=2 decimals) to integer basis points, then
                  //   interest = corpus_paise * rate_bps * months / (10000 * 12)
                  // in BigInt throughout, rounded half-up via (num + den/2) / den.
                  const rateBps = BigInt(Math.round(ratePct * 100));
                  const num = prev.total * rateBps * BigInt(months);
                  const den = 120000n; // 10000 (bps -> fraction) * 12 (months per year)
                  const interestMinor = (num + den / 2n) / den;
                  const n = { emp: prev.emp + interestMinor, er: prev.er, total: prev.total + interestMinor };
                  await repo.insertLedger(tx, {
                    id: ledgerId, tenantId: p.tenantId, accountId: acct.id, employeeId,
                    entryType: "interest", empAmountMinor: interestMinor, erAmountMinor: 0n,
                    deltaMinor: interestMinor, empBalanceMinor: n.emp, erBalanceMinor: n.er, balanceMinor: n.total,
                    narrative: `interest @ ${ratePct}% for ${months} month(s)`, createdBy: msg.actorId,
                  });
                  await repo.bumpAccountVersion(tx, p.tenantId, acct.id, msg.actorId, acct.version);
            break;
          }

          case "cpf_routes__debit": {
            // `repo.findAccount` never existed; the real helper is keyed on the
            // employee and takes no tx (it opens its own tenant-scoped read).
            const acct = await repo.findAccountByEmployee(p.tenantId, employeeId);
            if (!acct) return;
            const amount = BigInt(body.amountMinor);
            const entryType = body.entryType as "advance" | "withdrawal";
            // Was `(p.ledgerId as string) || id` — `id` is the EMPLOYEE id on
            // this op, so a second advance/withdrawal for the same employee
            // collided on the ledger primary key. Redelivery is already made
            // idempotent by markProcessed() above, so a fresh id is safe.
            const ledgerId = (p.ledgerId as string) || randomUUID();
            const prev = await repo.lockedBalance(tx, p.tenantId, acct);
            if (prev.total - amount < 0n) return;
            const erDraw = amount <= prev.er ? amount : prev.er;
            const empDraw = amount - erDraw;
            const n = { emp: prev.emp - empDraw, er: prev.er - erDraw, total: prev.total - amount };
            await repo.insertLedger(tx, {
              id: ledgerId, tenantId: p.tenantId, accountId: acct.id, employeeId,
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
