import type { Queue } from "@civitasone/queue";
import { db } from "../../shared/db.js";
import { cache } from "../../shared/infra.js";
import { enqueue, markProcessed } from "../../shared/outbox.js";
import { COMMANDS, EVENTS } from "../../topics.js";
import * as repo from "./repo.js";

const AUDIT = "audit.event.record";

export function registerLoansConsumers(queue: Queue): void {
  queue.subscribe(COMMANDS.loanCreate, async (msg) => {
    const p = msg.payload as {
      id: string; tenantId: string; loanNo: string; employeeId: string;
      loanType: string; principalMinor: number; emiMinor: number;
      tenureMonths: number; interestRatePct: number; currency: string;
    };
    await db.transaction(async (tx) => {
      if (!(await markProcessed(tx, msg.messageId))) return;
      await repo.insertLoan(tx, {
        id: p.id, tenantId: p.tenantId, loanNo: p.loanNo, employeeId: p.employeeId,
        loanType: p.loanType, principalMinor: BigInt(p.principalMinor),
        outstandingMinor: BigInt(p.principalMinor), emiMinor: BigInt(p.emiMinor),
        tenureMonths: p.tenureMonths, interestRatePct: String(p.interestRatePct),
        currency: p.currency as "INR", status: "applied",
        createdBy: msg.actorId, updatedBy: msg.actorId,
      });
      await audit(tx, msg, "create", "loan", p.id);
    });
    await cache.invalidate(cache.makeKey(msg.tenantId, "loans_emp", (msg.payload as any).employeeId));
  });

  queue.subscribe(COMMANDS.loanDisburse, async (msg) => {
    const p = msg.payload as { id: string; tenantId: string };
    await db.transaction(async (tx) => {
      if (!(await markProcessed(tx, msg.messageId))) return;
      const loan = await repo.findLoanByIdTx(tx, p.id);
      if (!loan) throw new Error(`loan ${p.id} not found`);
      await repo.updateLoan(tx, p.id, { status: "disbursed", disbursedAt: new Date(), updatedBy: msg.actorId });
      await enqueue(tx, {
        topic: EVENTS.loanDisbursed, eventType: EVENTS.loanDisbursed,
        tenantId: msg.tenantId, actorId: msg.actorId, correlationId: msg.correlationId,
        payload: { loanId: p.id, employeeId: loan.employeeId, principalMinor: loan.principalMinor.toString() },
      });
      await audit(tx, msg, "disburse", "loan", p.id);
    });
    await cache.invalidate(cache.makeKey(msg.tenantId, "payroll_loan", p.id));
    await cache.invalidate(cache.makeKey(msg.tenantId, "loans_emp", (msg.payload as any).employeeId ?? ""));
  });
}

async function audit(tx: any, msg: any, action: string, resourceType: string, resourceId: string): Promise<void> {
  await enqueue(tx, {
    topic: AUDIT, eventType: AUDIT,
    tenantId: msg.tenantId, actorId: msg.actorId, correlationId: msg.correlationId,
    payload: { service: "payroll", action, resourceType, resourceId, outcome: "success" },
  });
}
