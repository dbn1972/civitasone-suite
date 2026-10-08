import { randomUUID } from "node:crypto";
import type { RequestContext } from "@civitasone/types";
import { queue } from "../../shared/infra.js";
import { HttpError } from "../../shared/context.js";
import { COMMANDS } from "../../topics.js";
import * as repo from "./repo.js";
import { assertVerificationTransition, type VerificationAction } from "./domain.js";

// Reads the session (tenant-scoped) and rejects an out-of-lifecycle command
// before anything is enqueued.
async function guardSession(ctx: RequestContext, id: string, action: VerificationAction): Promise<void> {
  const session = await repo.findVerificationById(id, ctx.tenantId);
  if (!session) throw new HttpError(404, "NOT_FOUND", "verification session not found");
  try {
    assertVerificationTransition(session.status, action);
  } catch (err) {
    // Audit the rejected out-of-order command (best effort; the 409 still wins).
    await queue.publish("audit.event.record", {
      messageId: randomUUID(), type: "audit.event.record",
      tenantId: ctx.tenantId, actorId: ctx.actorId, correlationId: ctx.correlationId, schemaVersion: "1.0",
      payload: { service: "asset", action: `verification_${action}_rejected`, resourceType: "verification", resourceId: id, outcome: "failure", tenantId: ctx.tenantId },
    }).catch(() => undefined);
    throw err;
  }
}

export type Accepted = { id: string; status: string; correlationId: string };

async function pub(
  ctx: RequestContext, type: string, id: string, payload: Record<string, unknown>,
): Promise<Accepted> {
  await queue.publish(type, {
    messageId: randomUUID(), type,
    tenantId: ctx.tenantId, actorId: ctx.actorId, correlationId: ctx.correlationId,
    schemaVersion: "1.0",
    payload: { ...payload, id, tenantId: ctx.tenantId },
  });
  return { id, status: "accepted", correlationId: ctx.correlationId };
}

export async function createVerification(ctx: RequestContext, body: {
  verificationDate: string; notes?: string; location?: string;
}): Promise<Accepted> {
  const id = randomUUID();
  return pub(ctx, COMMANDS.verificationCreate, id, {
    verificationDate: body.verificationDate,
    notes: body.notes ?? null,
    location: body.location ?? null,
  });
}

export async function addVerificationItem(ctx: RequestContext, verificationId: string, body: {
  assetId: string; condition: string; foundAtLocation?: boolean; remarks?: string;
}): Promise<Accepted> {
  await guardSession(ctx, verificationId, "add-item");
  const id = randomUUID();
  return pub(ctx, COMMANDS.verificationItemAdd, id, {
    verificationId, assetId: body.assetId, condition: body.condition,
    foundAtLocation: body.foundAtLocation ?? true, remarks: body.remarks ?? null,
  });
}

export async function submitVerification(ctx: RequestContext, verificationId: string): Promise<Accepted> {
  await guardSession(ctx, verificationId, "submit");
  return pub(ctx, COMMANDS.verificationSubmit, verificationId, {});
}

export async function approveVerification(ctx: RequestContext, verificationId: string): Promise<Accepted> {
  // GAP2-ASSETS-VERIFICATION-01 (segregation of duties, GFR stock verification):
  // the approver may never be the same user who created/submitted the session.
  // Mirrors approveWriteoffRequest below and the condemnation maker-checker.
  const session = await repo.findVerificationById(verificationId, ctx.tenantId);
  if (!session) throw new HttpError(404, "NOT_FOUND", "verification session not found");
  if (session.createdBy === ctx.actorId) {
    throw new HttpError(403, "SELF_APPROVAL_FORBIDDEN", "the approver cannot be the person who created the verification session (segregation of duties)");
  }
  await guardSession(ctx, verificationId, "approve");
  return pub(ctx, COMMANDS.verificationApprove, verificationId, {});
}

export async function requestWriteoff(ctx: RequestContext, assetId: string, remarks?: string): Promise<Accepted> {
  const id = randomUUID();
  return pub(ctx, COMMANDS.writeoffRequest, id, { assetId, remarks: remarks ?? null });
}

export async function approveWriteoffRequest(ctx: RequestContext, requestId: string): Promise<Accepted> {
  // P0-2 Segregation of Duties (GFR Rule 173): reject self-approval before enqueue.
  const request = await repo.findWriteoffById(requestId, ctx.tenantId);
  if (!request) throw new HttpError(404, "NOT_FOUND", "writeoff request not found");
  if (request.status !== "pending") {
    throw new HttpError(409, "CONFLICT", `writeoff request is already ${request.status}`);
  }
  if (request.requestedBy === ctx.actorId) {
    throw new HttpError(403, "SELF_APPROVAL_FORBIDDEN", "approver must be different from requester (segregation of duties)");
  }
  return pub(ctx, COMMANDS.writeoffApprove, requestId, {});
}
