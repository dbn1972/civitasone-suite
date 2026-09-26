import { randomUUID } from "node:crypto";
import type { RequestContext } from "@civitasone/types";
import { queue, cache } from "../../shared/infra.js";
import { COMMANDS } from "../../topics.js";
import { HttpError } from "../../shared/context.js";
import type { CreateLoanBody } from "./validators.js";
import * as repo from "./repo.js";
import { decideCombinedEmiCap, sumActiveEmiMinor, MAX_COMBINED_LOAN_EMI_PCT_OF_GROSS } from "./policy.js";

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
  const [existingLoans, grossMinor] = await Promise.all([
    repo.findLoansByEmployee(ctx.tenantId, body.employeeId),
    repo.findLatestGrossMinorForEmployee(ctx.tenantId, body.employeeId),
  ]);
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

  const id = randomUUID();
  await queue.publish(COMMANDS.loanCreate, {
    messageId: id, type: COMMANDS.loanCreate,
    tenantId: ctx.tenantId, actorId: ctx.actorId, correlationId: ctx.correlationId, schemaVersion: "1.0",
    payload: { id, tenantId: ctx.tenantId, ...body },
  });
  return { id, status: "accepted", correlationId: ctx.correlationId };
}

export async function disburseLoan(ctx: RequestContext, id: string): Promise<Accepted> {
  await queue.publish(COMMANDS.loanDisburse, {
    type: COMMANDS.loanDisburse,
    tenantId: ctx.tenantId, actorId: ctx.actorId, correlationId: ctx.correlationId, schemaVersion: "1.0",
    payload: { id, tenantId: ctx.tenantId },
  });
  await cache.invalidate(cache.makeKey(ctx.tenantId, "payroll_loan", id));
  return { id, status: "accepted", correlationId: ctx.correlationId };
}
