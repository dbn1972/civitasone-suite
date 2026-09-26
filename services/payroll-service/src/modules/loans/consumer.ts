import type { Queue, CommandEnvelope } from "@civitasone/queue";
import { NonRetryableError } from "@civitasone/queue";
import { sql } from "drizzle-orm";
import { db } from "../../shared/db.js";
import { cache } from "../../shared/infra.js";
import { enqueue, markProcessed } from "../../shared/outbox.js";
import { COMMANDS, EVENTS } from "../../topics.js";
import * as repo from "./repo.js";
import { decideCombinedEmiCap, sumActiveEmiMinor, MAX_COMBINED_LOAN_EMI_PCT_OF_GROSS } from "./policy.js";

const AUDIT = "audit.event.record";

export function registerLoansConsumers(queue: Queue): void {
  queue.subscribe(COMMANDS.loanCreate, async (msg) => {
    try {
      const p = msg.payload as {
        id: string; tenantId: string; loanNo: string; employeeId: string;
        loanType: string; principalMinor: number; emiMinor: number;
        tenureMonths: number; interestRatePct: number; currency: string;
      };
      await db.transaction(async (tx) => {
        if (!(await markProcessed(tx, msg.messageId))) return;

        // BUG-1 (payroll loans EMI cap): authoritative, race-safe gate.
        // commands.ts already ran the same decideCombinedEmiCap evaluation
        // synchronously for immediate caller feedback, but that check is a
        // plain SELECT outside any lock -- two near-simultaneous createLoan
        // calls for the SAME employee could each read the pre-insert sum and
        // both pass. The advisory tx-lock below serializes them: the loser
        // blocks here until the winner's transaction commits (or rolls
        // back), then re-reads the sum -- now including the winner's row if
        // it committed -- so the combined cap can never actually be breached
        // even under a race. Mirrors this same service's
        // payroll/consumer.ts::processPayrollRun DUPLICATE_RUN_FOR_PERIOD
        // guard (identical hashtextextended(<namespaced key>, 0) pattern).
        const lockKey = `loan_emi_cap:${p.tenantId}:${p.employeeId}`;
        await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtextextended(${lockKey}, 0))`);
        const [existingLoans, grossMinor] = await Promise.all([
          repo.findLoansByEmployeeTx(tx, p.tenantId, p.employeeId),
          repo.findLatestGrossMinorForEmployeeTx(tx, p.tenantId, p.employeeId),
        ]);
        const existingEmiMinor = sumActiveEmiMinor(existingLoans);
        const decision = decideCombinedEmiCap(existingEmiMinor, BigInt(p.emiMinor), grossMinor);
        if (!decision.allowed) {
          // NonRetryableError: a known, permanent business rejection --
          // routes straight to the DLQ instead of retrying (retrying an
          // over-cap application can never succeed). Now actually visible:
          // see the catch block below and the MemoryQueue logging fix in
          // queue-service/src/bus.ts (same PR) for BUG-2's "silent command
          // loss" -- before that fix, a QUEUE_DRIVER=memory rejection like
          // this one (this fleet's own default for local dev/test) left
          // zero trace anywhere.
          throw new NonRetryableError(
            `LOAN_EMI_CAP_EXCEEDED: combined EMI ${decision.combinedEmiMinor} > cap ${decision.capMinor} ` +
            `(${MAX_COMBINED_LOAN_EMI_PCT_OF_GROSS}% of last known gross ${decision.grossMinor}) for employee ${p.employeeId}`,
          );
        }

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
    } catch (err) {
      logConsumerError(COMMANDS.loanCreate, msg, err);
      throw err;
    }
  });

  queue.subscribe(COMMANDS.loanDisburse, async (msg) => {
    try {
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
    } catch (err) {
      logConsumerError(COMMANDS.loanDisburse, msg, err);
      throw err;
    }
  });
}

/**
 * BUG-2b (silent command loss): neither subscribe handler above used to
 * catch its own errors -- a throw (e.g. the BigInt-overflow insert failure
 * from BUG-2a, or the NonRetryableError just above for BUG-1) propagated
 * only to the queue driver's own dispatch loop. Under QUEUE_DRIVER=sqs that
 * loop already logs it (bus.ts SqsQueue.logHandlerError); under
 * QUEUE_DRIVER=memory -- this service's own .env.example default, and every
 * service's vitest.config.ts default -- it did not (see the MemoryQueue fix
 * in services/queue-service/src/bus.ts in this same PR). Logging here too
 * means a rejected/failed loan command is traceable from this module's own
 * logs regardless of which queue driver is active, or whether the shared bus
 * fix above ever regresses. Mirrors bus.ts SqsQueue.logHandlerError's
 * structured shape/event name so one grep/log-shipper rule covers both.
 */
function logConsumerError(topic: string, msg: CommandEnvelope, err: unknown): void {
  // eslint-disable-next-line no-console -- structured operational error log
  console.error(
    JSON.stringify({
      level: "error",
      event: "queue_consumer_error",
      service: "payroll",
      module: "loans",
      topic,
      messageId: msg.messageId,
      correlationId: msg.correlationId,
      traceparent: msg.traceparent,
      err: err instanceof Error ? err.stack : String(err),
    }),
  );
}

async function audit(tx: any, msg: any, action: string, resourceType: string, resourceId: string): Promise<void> {
  await enqueue(tx, {
    topic: AUDIT, eventType: AUDIT,
    tenantId: msg.tenantId, actorId: msg.actorId, correlationId: msg.correlationId,
    payload: { service: "payroll", action, resourceType, resourceId, outcome: "success" },
  });
}
