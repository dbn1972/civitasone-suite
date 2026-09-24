import { randomUUID } from "node:crypto";
import type { RequestContext } from "@civitasone/types";
import { queue, cache } from "../../shared/infra.js";
import { COMMANDS } from "../../topics.js";
import type { CreateLeaveTypeBody, AllocateLeaveBody, ApplyLeaveBody } from "./validators.js";
import * as repo from "./repo.js";
import { HttpError } from "../../shared/context.js";
import { assertLeaveAppStatusTransition, DomainError } from "./domain.js";

export type Accepted = { id: string; status: string; correlationId: string };

export async function createLeaveType(ctx: RequestContext, body: CreateLeaveTypeBody): Promise<Accepted> {
  const id = randomUUID();
  await queue.publish(COMMANDS.leaveTypeCreate, {
    messageId: id, type: COMMANDS.leaveTypeCreate,
    tenantId: ctx.tenantId, actorId: ctx.actorId, correlationId: ctx.correlationId, schemaVersion: "1.0",
    payload: { id, tenantId: ctx.tenantId, ...body },
  });
  return { id, status: "accepted", correlationId: ctx.correlationId };
}

export async function allocateLeave(ctx: RequestContext, body: AllocateLeaveBody): Promise<Accepted> {
  const id = randomUUID();
  await queue.publish(COMMANDS.leaveAllocate, {
    messageId: id, type: COMMANDS.leaveAllocate,
    tenantId: ctx.tenantId, actorId: ctx.actorId, correlationId: ctx.correlationId, schemaVersion: "1.0",
    payload: { id, tenantId: ctx.tenantId, ...body, balanceDays: body.totalDays },
  });
  return { id, status: "accepted", correlationId: ctx.correlationId };
}

export async function applyLeave(ctx: RequestContext, body: ApplyLeaveBody): Promise<Accepted> {
  const id = randomUUID();
  await queue.publish(COMMANDS.leaveApply, {
    messageId: id, type: COMMANDS.leaveApply,
    tenantId: ctx.tenantId, actorId: ctx.actorId, correlationId: ctx.correlationId, schemaVersion: "1.0",
    payload: { id, tenantId: ctx.tenantId, ...body, status: "pending" },
  });
  return { id, status: "accepted", correlationId: ctx.correlationId };
}

export async function approveLeave(ctx: RequestContext, id: string): Promise<Accepted> {
  const leaveApp = await repo.findLeaveAppById(id, ctx.tenantId);
  if (!leaveApp) throw new HttpError(404, "NOT_FOUND", "leave application not found");
  if (leaveApp.createdBy === ctx.actorId) {
    throw new HttpError(403, "SELF_APPROVAL_FORBIDDEN", "Maker-checker: you cannot approve your own leave application.");
  }
  // HIGH fix: mirror rejectLeave's BUG-5 synchronous pre-check below — it was
  // missing here entirely. Without it, a stale/duplicate approve call (e.g.
  // an already-approved, already-rejected, or already-cancelled application)
  // gets a false 202 while the write silently fails deep in the async
  // consumer: the consumer's catch block only special-cases
  // LEAVE_ALREADY_PROCESSED (H2's race-safe "WHERE status='pending'" guard),
  // so a DomainError thrown by assertLeaveAppStatusTransition there is NOT
  // caught by that special case and instead propagates as an unhandled
  // consumer failure with no clear signal back to the caller. Assert the
  // transition is legal *before* returning 202, using the same leaveApp row
  // already fetched above for the self-approval check.
  try {
    assertLeaveAppStatusTransition(leaveApp.status, "approved");
  } catch (err) {
    if (err instanceof DomainError) throw new HttpError(409, err.code, err.message);
    throw err;
  }
  const messageId = randomUUID();
  await queue.publish(COMMANDS.leaveApprove, {
    messageId, type: COMMANDS.leaveApprove,
    tenantId: ctx.tenantId, actorId: ctx.actorId, correlationId: ctx.correlationId, schemaVersion: "1.0",
    payload: { id, tenantId: ctx.tenantId, approvedBy: ctx.actorId },
  });
  await cache.invalidate(cache.makeKey(ctx.tenantId, "leave_app", id));
  return { id, status: "accepted", correlationId: ctx.correlationId };
}

export async function rejectLeave(ctx: RequestContext, id: string, reason: string): Promise<Accepted> {
  const leaveApp = await repo.findLeaveAppById(id, ctx.tenantId);
  if (!leaveApp) throw new HttpError(404, "NOT_FOUND", "leave application not found");
  // BUG-3 fix: mirror approveLeave's maker-checker self-check — it was missing
  // here entirely, letting an applicant reject their own application.
  if (leaveApp.createdBy === ctx.actorId) {
    throw new HttpError(403, "SELF_APPROVAL_FORBIDDEN", "Maker-checker: you cannot reject your own leave application.");
  }
  // BUG-5 fix: synchronous pre-check mirroring the payroll duplicate-run guard
  // pattern (commands.ts fast-path ahead of the queue publish) — assert the
  // transition is legal *before* returning 202, instead of letting an
  // approved->rejected request accept and then silently no-op inside the async
  // consumer (assertLeaveAppStatusTransition already enforces this there).
  try {
    assertLeaveAppStatusTransition(leaveApp.status, "rejected");
  } catch (err) {
    if (err instanceof DomainError) throw new HttpError(409, err.code, err.message);
    throw err;
  }
  const messageId = randomUUID();
  await queue.publish(COMMANDS.leaveReject, {
    messageId, type: COMMANDS.leaveReject,
    tenantId: ctx.tenantId, actorId: ctx.actorId, correlationId: ctx.correlationId, schemaVersion: "1.0",
    payload: { id, tenantId: ctx.tenantId, rejectedBy: ctx.actorId, reason },
  });
  await cache.invalidate(cache.makeKey(ctx.tenantId, "leave_app", id));
  return { id, status: "accepted", correlationId: ctx.correlationId };
}
