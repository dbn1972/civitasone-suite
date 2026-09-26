import { randomUUID } from "node:crypto";
import type { RequestContext } from "@civitasone/types";
import { queue, cache } from "../../shared/infra.js";
import { COMMANDS } from "../../topics.js";
import { HttpError } from "../../shared/context.js";
import { assertValidFY, assertReappropriationValid, assertSanctionApproverDistinct, DomainError } from "./domain.js";
import * as repo from "./repo.js";
import { db } from "../../shared/db.js";
import type { CreateBudgetBody, ReappropriateBody, CreateSanctionBody, UpdateHeadHoABody, RejectSanctionBody, SubmitReappropriationBody } from "./validators.js";

export type Accepted = { id: string; status: string; correlationId: string };

function toDomain(err: unknown, status = 400): never {
  if (err instanceof DomainError) throw new HttpError(status, err.code, err.message);
  throw err;
}

export async function createBudget(ctx: RequestContext, body: CreateBudgetBody): Promise<Accepted> {
  assertValidFY(body.fy);
  const id = randomUUID();
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
    type: COMMANDS.budgetReappropriate,
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

export async function updateHeadHoA(ctx: RequestContext, id: string, body: UpdateHeadHoABody): Promise<void> {
  const head = await repo.findHeadById(id);
  if (!head || head.tenantId !== ctx.tenantId) throw new Error("head not found");
  // FIX: this previously wrote via the bare `db` import instead of an open
  // db.transaction(), so budget.finance_heads' FORCE ROW LEVEL SECURITY policy
  // saw current_tenant_id() as NULL (no app.tenant_id GUC set) and the UPDATE
  // matched zero rows -- silently, since drizzle doesn't surface affected-row
  // counts. Route still returned 200. Mirrors the already-correct sibling
  // PATCH /v1/finance/accounts/:id handler below (routes.ts), which wraps the
  // same repo.updateHead(tx, ...) call in db.transaction() for this reason.
  await db.transaction(async (tx) => {
    await repo.updateHead(tx, id, { hoaCode: body.hoaCode, updatedBy: ctx.actorId });
  });
  await cache.invalidate(cache.makeKey(ctx.tenantId, "accounts", "list:50"));
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
    type: COMMANDS.sanctionReject,
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
export async function submitSanctionForApproval(ctx: RequestContext, id: string): Promise<Accepted> {
  await queue.publish(COMMANDS.sanctionSubmitApproval, {
    type: COMMANDS.sanctionSubmitApproval,
    tenantId: ctx.tenantId, actorId: ctx.actorId, correlationId: ctx.correlationId, schemaVersion: "1.0",
    payload: { id, tenantId: ctx.tenantId },
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
export async function approveSanction(ctx: RequestContext, id: string): Promise<Accepted> {
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
  await queue.publish(COMMANDS.sanctionApprove, {
    type: COMMANDS.sanctionApprove,
    tenantId: ctx.tenantId, actorId: ctx.actorId, correlationId: ctx.correlationId, schemaVersion: "1.0",
    payload: { id, tenantId: ctx.tenantId },
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
