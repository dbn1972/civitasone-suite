import { randomUUID } from "node:crypto";
import type { RequestContext } from "@civitasone/types";
import { queue, cache } from "../../shared/infra.js";
import { COMMANDS } from "../../topics.js";
import { assertValidFY } from "./domain.js";
import * as repo from "./repo.js";
import { db } from "../../shared/db.js";
import type { CreateBudgetBody, ReappropriateBody, CreateSanctionBody, UpdateHeadHoABody, RejectSanctionBody, SubmitReappropriationBody } from "./validators.js";

export type Accepted = { id: string; status: string; correlationId: string };

export async function createBudget(ctx: RequestContext, body: CreateBudgetBody): Promise<Accepted> {
  assertValidFY(body.fy);
  const id = randomUUID();
  await queue.publish(COMMANDS.budgetCreate, {
    messageId: id, type: COMMANDS.budgetCreate,
    tenantId: ctx.tenantId, actorId: ctx.actorId, correlationId: ctx.correlationId, schemaVersion: "1.0",
    payload: { id, tenantId: ctx.tenantId, ...body },
  });
  return { id, status: "accepted", correlationId: ctx.correlationId };
}

export async function reappropriateBudget(ctx: RequestContext, id: string, body: ReappropriateBody): Promise<Accepted> {
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
  return { id, status: "accepted", correlationId: ctx.correlationId };
}

export async function updateHeadHoA(ctx: RequestContext, id: string, body: UpdateHeadHoABody): Promise<void> {
  const head = await repo.findHeadById(id);
  if (!head || head.tenantId !== ctx.tenantId) throw new Error("head not found");
  await repo.updateHead(db, id, { hoaCode: body.hoaCode, updatedBy: ctx.actorId });
  await cache.invalidate(cache.makeKey(ctx.tenantId, "accounts", "list:50"));
}

export async function rejectSanction(ctx: RequestContext, id: string, body: RejectSanctionBody): Promise<Accepted> {
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
