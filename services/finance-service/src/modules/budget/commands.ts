import { randomUUID } from "node:crypto";
import { idempotentId } from "@civitasone/auth";
import { ZodError } from "zod";
import type { RequestContext } from "@civitasone/types";
import { queue, cache } from "../../shared/infra.js";
import { COMMANDS } from "../../topics.js";
import { HttpError } from "../../shared/context.js";
import { assertValidFY, assertReappropriationValid, assertSanctionApproverDistinct, assertBudgetableHead, DomainError } from "./domain.js";
import * as repo from "./repo.js";
import { readSettings } from "../approvals/repo.js";
import { submitChangeRequest } from "../approvals/commands.js";
import type { CreateBudgetBody, ReappropriateBody, CreateSanctionBody, UpdateHeadHoABody, RejectSanctionBody, SubmitReappropriationBody } from "./validators.js";

export type Accepted = { id: string; status: string; correlationId: string };

function toDomain(err: unknown, status = 400): never {
  if (err instanceof DomainError) throw new HttpError(status, err.code, err.message);
  throw err;
}

/** A field-scoped 400 in the same envelope zod failures produce (fieldErrors[].field). */
function fieldError(field: string, message: string): never {
  throw new ZodError([{ code: "custom", path: [field], message }]);
}

export async function createBudget(ctx: RequestContext, body: CreateBudgetBody): Promise<Accepted> {
  assertValidFY(body.fy);
  // GAP-FINANCE-BUDGET-FORMULATION-NEW-02: the head must exist in THIS tenant
  // and be an expenditure head -- the form's picker filter is convenience
  // only; this is the real control (a direct API call can't bypass it).
  const head = await repo.findHeadByIdAndTenant(body.headId, ctx.tenantId);
  if (!head) fieldError("headId", "Budget head not found");
  try {
    assertBudgetableHead(head);
  } catch (err) {
    if (err instanceof DomainError) fieldError("headId", err.message);
    throw err;
  }
  // A client x-idempotency-key makes a retry (network timeout, double submit)
  // the SAME command: the consumer's markProcessed(messageId) drops the repeat.
  // The proposal itself is folded into the key so a reused key with a DIFFERENT
  // head/FY/amount is a new command, not silently swallowed.
  const id = idempotentId(
    ctx.idempotencyKey
      ? { idempotencyKey: `budget-create:${ctx.idempotencyKey}:${body.headId}:${body.fy}:${body.beMinor}`, tenantId: ctx.tenantId }
      : { tenantId: ctx.tenantId },
  );
  await queue.publish(COMMANDS.budgetCreate, {
    messageId: id, type: COMMANDS.budgetCreate,
    tenantId: ctx.tenantId, actorId: ctx.actorId, correlationId: ctx.correlationId, schemaVersion: "1.0",
    payload: { id, tenantId: ctx.tenantId, ...body },
  });
  await cache.invalidateResource(ctx.tenantId, "budgets");
  return { id, status: "accepted", correlationId: ctx.correlationId };
}

export async function reappropriateBudget(ctx: RequestContext, id: string, body: ReappropriateBody): Promise<Accepted> {
  // BUG FIX (missing synchronous pre-accept validation): this endpoint used to
  // publish COMMANDS.budgetReappropriate unconditionally -- whether the source
  // head actually has enough savings to cover the transfer (GFR Rule 10) was
  // only checked inside the async consumer (assertReappropriationValid in
  // sub(COMMANDS.budgetReappropriate, ...), consumer.ts), by which point the
  // caller had already moved on with a 202. An over-appropriation attempt
  // looked "accepted" instead of rejected. Same bug class as the
  // distribution-routes.ts / formulation-routes.ts fixes elsewhere in this
  // module. Read-only, no transaction, no lock: narrows but does not fully
  // close the TOCTOU window against a genuinely concurrent transfer off the
  // same source head -- the consumer's guarded UPDATE
  // (transferBudgetReMinorGuarded) remains the source of truth for that race.
  const source = await repo.findBudgetById(body.fromBudgetId);
  if (!source || source.tenantId !== ctx.tenantId) {
    throw new HttpError(404, "NOT_FOUND", "re-appropriation source budget not found");
  }
  try {
    assertReappropriationValid({ reMinor: source.reMinor, utilisedMinor: source.utilisedMinor }, body.amountMinor);
  } catch (err) { toDomain(err, 409); }
  await queue.publish(COMMANDS.budgetReappropriate, {
    messageId: randomUUID(), type: COMMANDS.budgetReappropriate,
    tenantId: ctx.tenantId, actorId: ctx.actorId, correlationId: ctx.correlationId, schemaVersion: "1.0",
    payload: { id, tenantId: ctx.tenantId, ...body },
  });
  await cache.invalidate(cache.makeKey(ctx.tenantId, "budget", id));
  return { id, status: "accepted", correlationId: ctx.correlationId };
}

export async function createSanction(ctx: RequestContext, body: CreateSanctionBody): Promise<Accepted> {
  const id = randomUUID();
  await queue.publish(COMMANDS.sanctionCreate, {
    messageId: id, type: COMMANDS.sanctionCreate,
    tenantId: ctx.tenantId, actorId: ctx.actorId, correlationId: ctx.correlationId, schemaVersion: "1.0",
    payload: { id, tenantId: ctx.tenantId, ...body },
  });
  await cache.invalidateResource(ctx.tenantId, "sanctions");
  return { id, status: "accepted", correlationId: ctx.correlationId };
}

export type HoaChangeResult = { status: "accepted" | "pending_approval"; requestId: string };

/**
 * GAP-FINANCE-CHART-OF-ACCOUNTS-NEW-01: HoA codes drive PFMS payment and budget
 * mapping. With the per-tenant second-approver setting on (default) a change is
 * held as a pending request that a DIFFERENT finance_admin approves (maker !=
 * checker, enforced in the decision consumer); with it off the officer's change
 * applies at once. Either way the old -> new code and reason are audited.
 */
export async function updateHeadHoA(ctx: RequestContext, id: string, body: UpdateHeadHoABody): Promise<HoaChangeResult> {
  const head = await repo.findHeadById(id);
  if (!head || head.tenantId !== ctx.tenantId) throw new HttpError(404, "NOT_FOUND", "head not found");
  const settings = await readSettings(ctx.tenantId);
  if (settings.makerCheckerEnabled) {
    const accepted = await submitChangeRequest(
      ctx, "hoa_change", id,
      { headId: id, headCode: head.code, oldHoaCode: head.hoaCode ?? null, hoaCode: body.hoaCode }, body.reason,
    );
    return { status: "pending_approval", requestId: accepted.id };
  }
  // Single-officer path: publish; the consumer applies it (write + audit in one transaction).
  const requestId = randomUUID();
  await queue.publish(COMMANDS.hoaChangeApply, {
    messageId: requestId, type: COMMANDS.hoaChangeApply,
    tenantId: ctx.tenantId, actorId: ctx.actorId, correlationId: ctx.correlationId, schemaVersion: "1.0",
    payload: { headId: id, hoaCode: body.hoaCode, reason: body.reason },
  });
  return { status: "accepted", requestId };
}

export async function rejectSanction(ctx: RequestContext, id: string, body: RejectSanctionBody): Promise<Accepted> {
  // BUG FIX (missing synchronous pre-accept validation): the maker-checker
  // guard (assertSanctionApproverDistinct -- R11 SoD applies to either
  // decision, not just approve) previously ran only inside the async consumer
  // (sub(COMMANDS.sanctionReject, ...), consumer.ts), so a self-reject attempt
  // still got a 202 accept -- the rejection happened invisibly, after the
  // response was already sent. Same bug class as the distribution-routes.ts /
  // formulation-routes.ts fixes elsewhere in this module; a plain identity
  // comparison on an already-persisted row, so lifting it synchronously fully
  // closes the gap.
  const existing = await repo.findSanctionByIdAndTenant(id, ctx.tenantId);
  if (!existing) throw new HttpError(404, "NOT_FOUND", "sanction not found");
  try {
    assertSanctionApproverDistinct(existing.createdBy, ctx.actorId);
  } catch (err) { toDomain(err, 409); }
  await queue.publish(COMMANDS.sanctionReject, {
    messageId: randomUUID(), type: COMMANDS.sanctionReject,
    tenantId: ctx.tenantId, actorId: ctx.actorId, correlationId: ctx.correlationId, schemaVersion: "1.0",
    payload: { id, tenantId: ctx.tenantId, reason: body.reason },
  });
  await cache.invalidate(cache.makeKey(ctx.tenantId, "sanction", id));
  return { id, status: "accepted", correlationId: ctx.correlationId };
}

/**
 * H1 — mark a sanction as submitted to eOffice for administrative approval.
 * The eFile itself is raised via the eOffice integration; once it is approved
 * the `finance.sanction.file_decided` callback (see eoffice-consumer) moves the
 * sanction to `approved`. This transition makes the source state honest while
 * the file is under approval.
 */
export async function submitSanctionForApproval(ctx: RequestContext, id: string, fileNo: string | null = null): Promise<Accepted> {
  await queue.publish(COMMANDS.sanctionSubmitApproval, {
    messageId: randomUUID(), type: COMMANDS.sanctionSubmitApproval,
    tenantId: ctx.tenantId, actorId: ctx.actorId, correlationId: ctx.correlationId, schemaVersion: "1.0",
    payload: { id, tenantId: ctx.tenantId, fileNo },
  });
  await cache.invalidate(cache.makeKey(ctx.tenantId, "sanction", id));
  return { id, status: "accepted", correlationId: ctx.correlationId };
}

/**
 * R11 — maker-checker approval of a sanction by a checker (an officer other than
 * the creator). The SoD check (approver ≠ maker) is enforced in the consumer
 * inside the write transaction. On approval the sanction becomes `approved` and
 * emits finance.sanction.approved.
 */
export async function approveSanction(ctx: RequestContext, id: string, reason?: string): Promise<Accepted> {
  // BUG FIX (missing synchronous pre-accept validation): R11 maker-checker
  // (assertSanctionApproverDistinct) previously ran only inside the async
  // consumer (sub(COMMANDS.sanctionApprove, ...), consumer.ts), so a
  // self-approve attempt still got a 202 accept -- the rejection happened
  // invisibly, after the response was already sent. Same bug class as the
  // distribution-routes.ts / formulation-routes.ts fixes elsewhere in this
  // module; a plain identity comparison on an already-persisted row, so
  // lifting it synchronously fully closes the gap. Deliberately NOT
  // replicating the consumer's idempotent already-approved short-circuit
  // here: re-approving an already-approved sanction is a harmless no-op on
  // the async side, not a failure, so a synchronous state check would
  // incorrectly turn that into an error.
  const existing = await repo.findSanctionByIdAndTenant(id, ctx.tenantId);
  if (!existing) throw new HttpError(404, "NOT_FOUND", "sanction not found");
  try {
    assertSanctionApproverDistinct(existing.createdBy, ctx.actorId);
  } catch (err) { toDomain(err, 409); }
  // GAP-FINANCE-BUDGET-SANCTIONS-DETAIL-01: while an eOffice file is deciding this
  // sanction, direct approval would race the file; the eOffice decision approves.
  if (existing.efileSubmittedAt) {
    throw new HttpError(409, "EFILE_IN_FLIGHT",
      `this sanction is awaiting an eOffice decision${existing.efileFileNo ? ` (file ${existing.efileFileNo})` : ""}; it cannot be approved directly`);
  }
  await queue.publish(COMMANDS.sanctionApprove, {
    messageId: randomUUID(), type: COMMANDS.sanctionApprove,
    tenantId: ctx.tenantId, actorId: ctx.actorId, correlationId: ctx.correlationId, schemaVersion: "1.0",
    payload: { id, tenantId: ctx.tenantId, ...(reason ? { reason } : {}) },
  });
  await cache.invalidate(cache.makeKey(ctx.tenantId, "sanction", id));
  return { id, status: "accepted", correlationId: ctx.correlationId };
}

/**
 * Submit a budget re-appropriation to eOffice for administrative approval.
 * Creates the re-appropriation request in status `pending_approval` (the route
 * `:id` is the request id / eFile refId). The eFile is raised via the eOffice
 * integration; once it is approved the `finance.reappropriation.file_decided`
 * callback (see reappropriation-eoffice-consumer) moves the request to
 * `approved` AND applies the change to the target budget's reMinor — so the
 * approval actually executes the re-appropriation.
 */
export async function submitReappropriationForApproval(ctx: RequestContext, id: string, body: SubmitReappropriationBody): Promise<Accepted> {
  await queue.publish(COMMANDS.reappropriationSubmitApproval, {
    messageId: id, type: COMMANDS.reappropriationSubmitApproval,
    tenantId: ctx.tenantId, actorId: ctx.actorId, correlationId: ctx.correlationId, schemaVersion: "1.0",
    payload: { id, tenantId: ctx.tenantId, ...body },
  });
  await cache.invalidate(cache.makeKey(ctx.tenantId, "reappropriation", id));
  return { id, status: "accepted", correlationId: ctx.correlationId };
}
