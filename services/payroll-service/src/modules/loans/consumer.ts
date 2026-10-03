import type { Queue, CommandEnvelope } from "@civitasone/queue";
import { NonRetryableError } from "@civitasone/queue";
import { sql } from "drizzle-orm";
import { db } from "../../shared/db.js";
import { cache } from "../../shared/infra.js";
import { enqueue, markProcessed } from "../../shared/outbox.js";
import { COMMANDS, EVENTS } from "../../topics.js";
import * as repo from "./repo.js";
import { checkLoanTerms, decideCombinedEmiCap, decideDisbursal, formatLoanNo, sumActiveEmiMinor, MAX_COMBINED_LOAN_EMI_PCT_OF_GROSS } from "./policy.js";

const AUDIT = "audit.event.record";

export function registerLoansConsumers(queue: Queue): void {
  queue.subscribe(COMMANDS.loanCreate, async (msg) => {
    try {
      const p = msg.payload as {
        id: string; tenantId: string; loanNo?: string; employeeId: string;
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

        // GAP-PAYROLL-LOANS-05: authoritative terms re-check (the route's is a fast pre-check).
        const terms = checkLoanTerms({
          principalMinor: BigInt(p.principalMinor), emiMinor: BigInt(p.emiMinor),
          tenureMonths: p.tenureMonths, interestRatePct: p.interestRatePct,
        });
        if (!terms.ok) throw new NonRetryableError(`LOAN_${terms.code}: ${terms.message}`);

        // GAP-PAYROLL-LOANS-05: server-allocated loan number when none was typed.
        const loanNo = p.loanNo ?? await allocateLoanNo(tx as unknown as { execute: (q: ReturnType<typeof sql>) => Promise<unknown> }, p.tenantId);
        await insertLoanOrReject(tx, loanNo, {
          id: p.id, tenantId: p.tenantId, loanNo, employeeId: p.employeeId,
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
      const p = msg.payload as { id: string; tenantId: string; employeeId?: string; reason?: string };
      let employeeId = p.employeeId ?? "";
      await db.transaction(async (tx) => {
        if (!(await markProcessed(tx, msg.messageId))) return;
        // GAP-PAYROLL-LOANS-02: tenant-scoped + FOR UPDATE (was id-only, no
        // lock), then the authoritative maker-checker / status re-check --
        // commands.ts's pre-check is not race-safe on its own.
        const loan = await repo.findLoanByIdForUpdateTx(tx, p.id, p.tenantId);
        if (!loan) throw new NonRetryableError(`loan ${p.id} not found`);
        employeeId = loan.employeeId;
        const decision = decideDisbursal(loan, msg.actorId);
        if (!decision.allowed) {
          throw new NonRetryableError(`${decision.code}: ${decision.message} (loan ${p.id})`);
        }
        await repo.updateLoan(tx, p.id, { status: "disbursed", disbursedAt: new Date(), updatedBy: msg.actorId });
        await enqueue(tx, {
          topic: EVENTS.loanDisbursed, eventType: EVENTS.loanDisbursed,
          tenantId: msg.tenantId, actorId: msg.actorId, correlationId: msg.correlationId,
          payload: { loanId: p.id, employeeId: loan.employeeId, principalMinor: loan.principalMinor.toString() },
        });
        await audit(tx, msg, "disburse", "loan", p.id, p.reason ? { reason: p.reason } : undefined);
      });
      await cache.invalidate(cache.makeKey(msg.tenantId, "payroll_loan", p.id));
      // Was keyed on payload.employeeId, which the disburse command never
      // carried -- so the per-employee list cache was never invalidated and
      // the loans page kept showing "applied" until the cache TTL expired.
      if (employeeId) await cache.invalidate(cache.makeKey(msg.tenantId, "loans_emp", employeeId));
    } catch (err) {
      logConsumerError(COMMANDS.loanDisburse, msg, err);
      throw err;
    }
  });
}

/**
 * GAP-PAYROLL-LOANS-05: the UNIQUE (tenant_id, loan_no) constraint
 * (migrations/0001_init.sql) is the race-safe duplicate-loan-number guard
 * behind commands.ts's plain-SELECT pre-check. A violation is a permanent
 * business rejection -- retrying can never succeed -- so surface it as a
 * NonRetryableError (straight to the DLQ, logged below) instead of a
 * generic error the queue would retry until it gives up.
 */
/**
 * Next LN-<year>-<seq> for the tenant. The counter row is incremented in the
 * same transaction as the loan insert (concurrent creates serialise on it, so
 * two loans never get the same number); a number already taken by a
 * hand-typed loan is skipped, never reused.
 */
async function allocateLoanNo(tx: { execute: (q: ReturnType<typeof sql>) => Promise<unknown> }, tenantId: string): Promise<string> {
  const year = Number(new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Kolkata", year: "numeric" }).format(new Date()));
  for (let attempt = 0; attempt < 20; attempt++) {
    const rows = (await tx.execute(sql`
      INSERT INTO loans.loan_number_counters (tenant_id, year, last_seq)
      VALUES (${tenantId}::uuid, ${year}, 1)
      ON CONFLICT (tenant_id, year) DO UPDATE SET last_seq = loans.loan_number_counters.last_seq + 1
      RETURNING last_seq
    `)) as unknown as Array<{ last_seq: number }>;
    const candidate = formatLoanNo(year, rows[0]!.last_seq);
    const taken = (await tx.execute(sql`
      SELECT 1 FROM loans.payroll_loans WHERE tenant_id = ${tenantId}::uuid AND loan_no = ${candidate} LIMIT 1
    `)) as unknown as unknown[];
    if (taken.length === 0) return candidate;
  }
  throw new Error("could not allocate a free loan number");
}

async function insertLoanOrReject(tx: Parameters<typeof repo.insertLoan>[0], loanNo: string, row: Parameters<typeof repo.insertLoan>[1]): Promise<void> {
  try {
    await repo.insertLoan(tx, row);
  } catch (err) {
    if (isUniqueViolation(err)) {
      throw new NonRetryableError(`LOAN_NO_TAKEN: loan number ${loanNo} is already in use in this tenant`);
    }
    throw err;
  }
}

export function isUniqueViolation(err: unknown): boolean {
  const codeOf = (e: unknown): unknown => (e && typeof e === "object" ? (e as { code?: unknown }).code : undefined);
  if (codeOf(err) === "23505") return true;
  // drizzle may wrap the driver error (DrizzleQueryError.cause).
  const cause = err && typeof err === "object" ? (err as { cause?: unknown }).cause : undefined;
  return codeOf(cause) === "23505";
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

async function audit(tx: any, msg: any, action: string, resourceType: string, resourceId: string, extra?: Record<string, string>): Promise<void> {
  await enqueue(tx, {
    topic: AUDIT, eventType: AUDIT,
    tenantId: msg.tenantId, actorId: msg.actorId, correlationId: msg.correlationId,
    payload: { service: "payroll", action, resourceType, resourceId, outcome: "success", ...extra },
  });
}
