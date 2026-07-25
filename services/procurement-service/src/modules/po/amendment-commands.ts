import { randomUUID } from "node:crypto";
import type { RequestContext } from "@civitasone/types";
import { queue, cache } from "../../shared/infra.js";
import { COMMANDS } from "../../topics.js";
import { HttpError } from "../../shared/context.js";
import * as poRepo from "./repo.js";
import * as amendRepo from "./amendment-repo.js";
import { assertPoAmendable, assertDistinctMakerChecker, AmendmentDomainError } from "./amendment-domain.js";
import type {
  RequestAmendmentBody, ApproveAmendmentBody, RejectAmendmentBody,
  AddMilestoneBody, UpdateMilestoneBody, ClosePoBody,
} from "./amendment-validators.js";

export type Accepted = { id: string; status: string; correlationId: string };

async function poOr404(ctx: RequestContext, poId: string) {
  const po = await poRepo.findPoById(poId, ctx.tenantId);
  if (!po) throw new HttpError(404, "NOT_FOUND", "PO not found");
  return po;
}

export async function requestAmendment(ctx: RequestContext, poId: string, body: RequestAmendmentBody): Promise<Accepted> {
  const po = await poOr404(ctx, poId);
  try {
    assertPoAmendable(po.status);
  } catch (err) {
    if (err instanceof AmendmentDomainError) throw new HttpError(409, err.code, err.message);
    throw err;
  }
  const id = randomUUID();
  await queue.publish(COMMANDS.poAmendmentRequest, {
    messageId: id, type: COMMANDS.poAmendmentRequest,
    tenantId: ctx.tenantId, actorId: ctx.actorId, correlationId: ctx.correlationId, schemaVersion: "1.0",
    payload: { id, poId, tenantId: ctx.tenantId, ...body },
  });
  return { id, status: "accepted", correlationId: ctx.correlationId };
}

export async function approveAmendment(ctx: RequestContext, poId: string, amendmentId: string, body: ApproveAmendmentBody): Promise<Accepted> {
  await poOr404(ctx, poId);
  const amendment = await runReadAmendment(ctx, amendmentId);
  // Maker-checker: approver must differ from requester — reject self-approval with 403.
  try {
    assertDistinctMakerChecker(amendment.requestedBy, ctx.actorId);
  } catch (err) {
    if (err instanceof AmendmentDomainError) throw new HttpError(403, err.code, err.message);
    throw err;
  }
  await queue.publish(COMMANDS.poAmendmentApprove, {
    messageId: randomUUID(), type: COMMANDS.poAmendmentApprove,
    tenantId: ctx.tenantId, actorId: ctx.actorId, correlationId: ctx.correlationId, schemaVersion: "1.0",
    payload: { poId, amendmentId, tenantId: ctx.tenantId, notes: body.notes },
  });
  await cache.invalidate(cache.makeKey(ctx.tenantId, "po", poId));
  return { id: amendmentId, status: "accepted", correlationId: ctx.correlationId };
}

export async function rejectAmendment(ctx: RequestContext, poId: string, amendmentId: string, body: RejectAmendmentBody): Promise<Accepted> {
  await poOr404(ctx, poId);
  await runReadAmendment(ctx, amendmentId);
  await queue.publish(COMMANDS.poAmendmentReject, {
    messageId: randomUUID(), type: COMMANDS.poAmendmentReject,
    tenantId: ctx.tenantId, actorId: ctx.actorId, correlationId: ctx.correlationId, schemaVersion: "1.0",
    payload: { poId, amendmentId, tenantId: ctx.tenantId, reason: body.reason },
  });
  await cache.invalidate(cache.makeKey(ctx.tenantId, "po", poId));
  return { id: amendmentId, status: "accepted", correlationId: ctx.correlationId };
}

export async function addMilestone(ctx: RequestContext, poId: string, body: AddMilestoneBody): Promise<Accepted> {
  await poOr404(ctx, poId);
  const id = randomUUID();
  await queue.publish(COMMANDS.poMilestoneAdd, {
    messageId: id, type: COMMANDS.poMilestoneAdd,
    tenantId: ctx.tenantId, actorId: ctx.actorId, correlationId: ctx.correlationId, schemaVersion: "1.0",
    payload: { id, poId, tenantId: ctx.tenantId, ...body },
  });
  await cache.invalidate(cache.makeKey(ctx.tenantId, "po", poId));
  return { id, status: "accepted", correlationId: ctx.correlationId };
}

export async function updateMilestone(ctx: RequestContext, poId: string, milestoneId: string, body: UpdateMilestoneBody): Promise<Accepted> {
  await poOr404(ctx, poId);
  await queue.publish(COMMANDS.poMilestoneUpdate, {
    messageId: randomUUID(), type: COMMANDS.poMilestoneUpdate,
    tenantId: ctx.tenantId, actorId: ctx.actorId, correlationId: ctx.correlationId, schemaVersion: "1.0",
    payload: { poId, milestoneId, tenantId: ctx.tenantId, ...body },
  });
  await cache.invalidate(cache.makeKey(ctx.tenantId, "po", poId));
  return { id: milestoneId, status: "accepted", correlationId: ctx.correlationId };
}

export async function closePo(ctx: RequestContext, poId: string, body: ClosePoBody): Promise<Accepted> {
  await poOr404(ctx, poId);
  await queue.publish(COMMANDS.poClose, {
    messageId: randomUUID(), type: COMMANDS.poClose,
    tenantId: ctx.tenantId, actorId: ctx.actorId, correlationId: ctx.correlationId, schemaVersion: "1.0",
    payload: { poId, tenantId: ctx.tenantId, notes: body.notes },
  });
  await cache.invalidate(cache.makeKey(ctx.tenantId, "po", poId));
  return { id: poId, status: "accepted", correlationId: ctx.correlationId };
}

async function runReadAmendment(ctx: RequestContext, amendmentId: string) {
  const { db } = await import("../../shared/db.js");
  const amendment = await db.transaction((tx) => amendRepo.findAmendmentByIdTx(tx, amendmentId, ctx.tenantId));
  if (!amendment) throw new HttpError(404, "NOT_FOUND", "amendment not found");
  return amendment;
}
