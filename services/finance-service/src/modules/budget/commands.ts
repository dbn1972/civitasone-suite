import { randomUUID } from "node:crypto";
import { idempotentId } from "@civitasone/auth";
import { db } from "../../shared/db.js";
import { approveSanctionTx, assertSanctionWithinAllocationTx, sanctionPreRead, SanctionBudgetExceeded } from "./sanction-control.js";
import { currentFyIST } from "../../shared/ist-date.js";
import { ZodError } from "zod";
import type { RequestContext } from "@civitasone/types";
import { queue, cache } from "../../shared/infra.js";
import { COMMANDS } from "../../topics.js";
import { HttpError } from "../../shared/context.js";
import { assertValidFY, assertReappropriationValid, assertSanctionApproverDistinct, assertBudgetableHead, isSanctionAwaitingDecision, DomainError } from "./domain.js";
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
  // UAT B23 (DLQ gate): finance_budgets is UNIQUE (tenant_id, head_id, fy). A second budget for a head+FY
  // that already has one used to be 202-accepted and then died in the worker on the unique index (retried,
  // then dead-lettered) while the user believed it was created. Refuse it here with a 409 the form can show.
  // A replay of the SAME idempotent command (the existing row carries this command's id) is still a 202.
  const existing = await repo.findBudget(body.headId, body.fy, ctx.tenantId);
  if (existing) {
    if (existing.id === id) return { id, status: "accepted", correlationId: ctx.correlationId };
    throw new HttpError(409, "BUDGET_EXISTS", `A budget for this head already exists for FY ${body.fy}. Edit or re-appropriate the existing budget instead.`, [
      { field: "headId", message: `This head already has a budget for FY ${body.fy}.`, code: "BUDGET_EXISTS" },
    ], { existingBudgetId: existing.id });
  }
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
  // UAT b24: sanction_no is UNIQUE per tenant. A repeat used to be 202-accepted, retried 5x and dead-lettered.
  if (await repo.findSanctionByNo(ctx.tenantId, body.sanctionNo)) {
    throw new HttpError(409, "DUPLICATE_SANCTION_NO", `Sanction number ${body.sanctionNo} already exists. Use a different number.`, [
      { field: "sanctionNo", message: "This sanction number is already used.", code: "DUPLICATE_SANCTION_NO" },
    ]);
  }
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
  // UAT bundle 22 (W1/W5): an already decided sanction cannot be rejected. Refuse now (409) instead of
  // accepting (202) a command the worker would drop, and never let a late reject touch an approved sanction.
  if (!isSanctionAwaitingDecision(existing.status)) {
    throw new HttpError(409, "INVALID_STATE_TRANSITION", `a ${existing.status} sanction cannot be rejected`);
  }
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
  // UAT W8-D (P1): the consumer rejects an unknown / foreign sanction (NonRetryableError);
  // say so now (404) instead of 202-accepting a submission that can only fail.
  const existing = await repo.findSanctionByIdAndTenant(id, ctx.tenantId);
  if (!existing) throw new HttpError(404, "NOT_FOUND", "sanction not found");
  // UAT bundle 22 (W5): a decided sanction is not pulled back to pending; the worker would drop it after the 202.
  if (!isSanctionAwaitingDecision(existing.status)) {
    throw new HttpError(409, "INVALID_STATE_TRANSITION", `a ${existing.status} sanction cannot be submitted for approval`);
  }
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
  // UAT bundle 22 (W5): an already decided sanction (approved, rejected, cancelled, exhausted) cannot be approved
  // again. 409 now, instead of a 202 for a decision that is then silently ignored.
  if (!isSanctionAwaitingDecision(existing.status)) {
    throw new HttpError(409, "INVALID_STATE_TRANSITION", `a ${existing.status} sanction cannot be approved`);
  }
  // UAT T-EDGE TE-02: the approval is applied HERE, synchronously, in one transaction that locks the head allocation
  // row and checks available = allocation - (approved sanctions + committed + expended). Two approvals racing on one
  // head serialise on that lock: exactly one is approved, the other gets 422 BUDGET_EXCEEDED with what is left. (A
  // queued approval could only refuse after its 202 had already been sent.) The consumer keeps the same rule for a
  // command published any other way.
  const fy = currentFyIST();
  const pre = await sanctionPreRead(ctx.tenantId, existing.headId, fy);
  let approved: boolean;
  try {
    approved = await db.transaction((tx) => approveSanctionTx(tx, ctx, { id, headId: existing.headId, amountMinor: existing.amountMinor }, fy, pre, reason));
  } catch (err) { throw sanctionLimitHttpError(err); }
  if (!approved) throw new HttpError(409, "SANCTION_STATE_CHANGED", "this sanction changed while it was being approved (decided by another officer, or sent to eOffice); reload it");
  await cache.invalidate(cache.makeKey(ctx.tenantId, "sanction", id));
  await cache.invalidateResource(ctx.tenantId, "sanctions");
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

/** UAT T-EDGE TE-02: the sanction allocation refusals as HTTP answers (422, with the available amount). */
export function sanctionLimitHttpError(err: unknown): unknown {
  if (err instanceof SanctionBudgetExceeded) {
    const avail = err.availableMinor > 0n ? err.availableMinor : 0n;
    const rupees = `${avail / 100n}.${String(avail % 100n).padStart(2, "0")}`;
    return new HttpError(422, "BUDGET_EXCEEDED", err.message.replace(/^\[[A-Z_]+\]\s*/, ""), [
      { field: "amountMinor", message: `Only Rs ${rupees} is still available on this head for the year (allocation less approved sanctions, commitments and expenditure).` },
    ]);
  }
  if (err instanceof DomainError && err.code === "NO_BUDGET_PROVISION") {
    return new HttpError(422, err.code, err.message.replace(/^\[[A-Z_]+\]\s*/, ""), [{ field: "headId", message: "This head has no budget provision or allocation for the financial year." }]);
  }
  return err;
}

/** UAT T-EDGE TE-02: synchronous create-time check (the create consumer re-checks under the lock). */
export async function assertSanctionCreatable(ctx: RequestContext, headId: string, amountMinor: bigint): Promise<void> {
  const fy = currentFyIST();
  const pre = await sanctionPreRead(ctx.tenantId, headId, fy);
  try {
    await db.transaction((tx) => assertSanctionWithinAllocationTx(tx, ctx.tenantId, { id: randomUUID(), headId, amountMinor }, fy, pre));
  } catch (err) { throw sanctionLimitHttpError(err); }
}
