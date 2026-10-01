import { randomUUID } from "node:crypto";
import type { RequestContext } from "@civitasone/types";
import { queue, cache } from "../../shared/infra.js";
import { COMMANDS } from "../../topics.js";
import { HttpError } from "../../shared/context.js";
import { deterministicUuid } from "../../shared/deterministic-id.js";
import type { CreateLoanBody, DisburseLoanBody } from "./validators.js";
import * as repo from "./repo.js";
import { decideCombinedEmiCap, decideDisbursal, sumActiveEmiMinor, MAX_COMBINED_LOAN_EMI_PCT_OF_GROSS } from "./policy.js";

const AUDIT_TOPIC = "audit.event.record";

export type Accepted = { id: string; status: string; correlationId: string };

export async function createLoan(ctx: RequestContext, body: CreateLoanBody): Promise<Accepted> {
  // BUG-1 (payroll loans EMI cap): fast, synchronous pre-check so a caller
  // gets an immediate, clear rejection for the ordinary (non-race) case
  // instead of a 202 that is quietly rejected later -- the same "fake
  // success" shape BUG-2 in this PR fixes elsewhere in this module. This
  // check alone is NOT race-safe (two near-simultaneous requests for the
  // same employee could both pass this plain SELECT); consumer.ts's
  // assertCombinedEmiWithinCap-equivalent block re-checks it, transaction-
  // scoped and advisory-locked, immediately before the insert -- see that
  // file and policy.ts for the full rationale.
  // GAP-PAYROLL-LOANS-05: honour a client x-idempotency-key -- a retried
  // submit maps to the same loan id / messageId, so the consumer's inbox
  // dedup (markProcessed) files the loan once. Without a key, behaviour is
  // unchanged (fresh id per call).
  const id = ctx.idempotencyKey
    ? deterministicUuid(`payroll-loan-create:${ctx.tenantId}:${ctx.idempotencyKey}`)
    : randomUUID();

  const [existingLoans, grossMinor, duplicateLoanId] = await Promise.all([
    repo.findLoansByEmployee(ctx.tenantId, body.employeeId),
    repo.findLatestGrossMinorForEmployee(ctx.tenantId, body.employeeId),
    repo.findLoanIdByLoanNo(ctx.tenantId, body.loanNo),
  ]);
  // GAP-PAYROLL-LOANS-05: loan numbers are typed by hand; reject a number
  // already used in this tenant instead of silently filing a second loan
  // under it. Not race-safe (no UNIQUE constraint exists yet) -- see
  // repo.findLoanIdByLoanNo.
  if (duplicateLoanId) {
    // The same idempotent request already landed: answer as before.
    if (duplicateLoanId === id) return { id, status: "accepted", correlationId: ctx.correlationId };
    throw new HttpError(409, "LOAN_NO_TAKEN", `loan number ${body.loanNo} is already in use`);
  }
  const existingEmiMinor = sumActiveEmiMinor(existingLoans);
  const decision = decideCombinedEmiCap(existingEmiMinor, BigInt(body.emiMinor), grossMinor);
  if (!decision.allowed) {
    throw new HttpError(
      422,
      "LOAN_EMI_CAP_EXCEEDED",
      `combined monthly EMI ${decision.combinedEmiMinor} (existing ${decision.existingEmiMinor} + new ${body.emiMinor}) ` +
      `would exceed the placeholder cap of ${decision.capMinor} (${MAX_COMBINED_LOAN_EMI_PCT_OF_GROSS}% of last known gross ${decision.grossMinor}); ` +
      `see loans/policy.ts`,
    );
  }

  await queue.publish(COMMANDS.loanCreate, {
    messageId: id, type: COMMANDS.loanCreate,
    tenantId: ctx.tenantId, actorId: ctx.actorId, correlationId: ctx.correlationId, schemaVersion: "1.0",
    payload: { id, tenantId: ctx.tenantId, ...body },
  });
  return { id, status: "accepted", correlationId: ctx.correlationId };
}

/**
 * GAP-PAYROLL-LOANS-02: synchronous pre-check so the caller gets an
 * immediate 404/403/409 instead of a 202 that the consumer later rejects.
 * consumer.ts re-runs the same decideDisbursal() under a row lock -- this
 * pre-check alone is not race-safe.
 */
export async function disburseLoan(ctx: RequestContext, id: string, body: DisburseLoanBody = {}): Promise<Accepted> {
  const loan = await repo.findLoanById(id, ctx.tenantId);
  if (!loan) throw new HttpError(404, "NOT_FOUND", "loan not found");
  const decision = decideDisbursal(loan, ctx.actorId);
  if (!decision.allowed) {
    if (decision.code === "SELF_DISBURSE_FORBIDDEN") {
      // A blocked segregation-of-duties attempt is itself audit-worthy.
      // Queue-first (no Postgres write in the request path), same shape as
      // estab-service files/routes.ts publishFileAccessAudit.
      await queue.publish(AUDIT_TOPIC, {
        messageId: randomUUID(),
        type: AUDIT_TOPIC,
        tenantId: ctx.tenantId, actorId: ctx.actorId, correlationId: ctx.correlationId, schemaVersion: "1.0",
        payload: {
          service: "payroll", action: "disburse", resourceType: "loan", resourceId: id,
          outcome: "denied", denialCode: decision.code, employeeId: loan.employeeId,
        },
      });
    }
    throw new HttpError(decision.status, decision.code, decision.message);
  }
  await queue.publish(COMMANDS.loanDisburse, {
    // Same officer double-submitting the same loan dedupes; a different
    // officer's attempt is a distinct command.
    messageId: deterministicUuid(`payroll-loan-disburse:${id}:${ctx.actorId}`),
    type: COMMANDS.loanDisburse,
    tenantId: ctx.tenantId, actorId: ctx.actorId, correlationId: ctx.correlationId, schemaVersion: "1.0",
    payload: { id, tenantId: ctx.tenantId, employeeId: loan.employeeId, ...(body.reason ? { reason: body.reason } : {}) },
  });
  await cache.invalidate(cache.makeKey(ctx.tenantId, "payroll_loan", id));
  await cache.invalidate(cache.makeKey(ctx.tenantId, "loans_emp", loan.employeeId));
  return { id, status: "accepted", correlationId: ctx.correlationId };
}
