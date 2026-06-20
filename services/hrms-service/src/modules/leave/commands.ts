import { randomUUID } from "node:crypto";
import type { RequestContext } from "@civitasone/types";
import { queue, cache } from "../../shared/infra.js";
import { COMMANDS } from "../../topics.js";
import type { CreateLeaveTypeBody, AllocateLeaveBody, ApplyLeaveBody } from "./validators.js";

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
  await queue.publish(COMMANDS.leaveApprove, {
    type: COMMANDS.leaveApprove,
    tenantId: ctx.tenantId, actorId: ctx.actorId, correlationId: ctx.correlationId, schemaVersion: "1.0",
    payload: { id, tenantId: ctx.tenantId, approvedBy: ctx.actorId },
  });
  await cache.invalidate(cache.makeKey(ctx.tenantId, "leave_app", id));
  return { id, status: "accepted", correlationId: ctx.correlationId };
}
