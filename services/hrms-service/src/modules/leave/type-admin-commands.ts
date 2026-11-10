import { randomUUID } from "node:crypto";
import type { RequestContext } from "@civitasone/types";
import { queue } from "../../shared/infra.js";
import { COMMANDS } from "../../topics.js";
import type { UpdateLeaveTypeBody } from "./type-admin-validators.js";
import type { LeaveTypeImpact } from "./type-admin-repo.js";

export type Accepted = { id: string; status: string; correlationId: string };

export interface LeaveTypeUpdatePayload { id: string; changes: Omit<UpdateLeaveTypeBody, "expectedVersion"> }
export interface LeaveTypeChangeRequestPayload { id: string; leaveTypeId: string; action: "deactivate"; reason: string; impact: LeaveTypeImpact }
export interface LeaveTypeChangeDecidePayload { requestId: string; decision: "approve" | "reject"; note: string | null }
export interface AllocEndPayload { id: string; reason: string }

async function publish(ctx: RequestContext, topic: string, id: string, payload: Record<string, unknown>): Promise<Accepted> {
  await queue.publish(topic, {
    messageId: randomUUID(), type: topic,
    tenantId: ctx.tenantId, actorId: ctx.actorId, correlationId: ctx.correlationId, schemaVersion: "1.0",
    payload,
  });
  return { id, status: "accepted", correlationId: ctx.correlationId };
}

export async function updateLeaveType(ctx: RequestContext, id: string, body: UpdateLeaveTypeBody): Promise<Accepted> {
  const { expectedVersion: _v, ...changes } = body;
  return publish(ctx, COMMANDS.leaveTypeUpdate, id, { id, changes } satisfies LeaveTypeUpdatePayload);
}

export async function requestLeaveTypeDeactivation(ctx: RequestContext, leaveTypeId: string, reason: string, impact: LeaveTypeImpact): Promise<Accepted> {
  const id = randomUUID();
  return publish(ctx, COMMANDS.leaveTypeChangeRequest, id, { id, leaveTypeId, action: "deactivate", reason, impact } satisfies LeaveTypeChangeRequestPayload);
}

export async function decideLeaveTypeChange(ctx: RequestContext, requestId: string, decision: "approve" | "reject", note: string | null): Promise<Accepted> {
  return publish(ctx, COMMANDS.leaveTypeChangeDecide, requestId, { requestId, decision, note } satisfies LeaveTypeChangeDecidePayload);
}

export async function reactivateLeaveType(ctx: RequestContext, id: string): Promise<Accepted> {
  return publish(ctx, COMMANDS.leaveTypeReactivate, id, { id });
}

export async function endAllocation(ctx: RequestContext, id: string, reason: string): Promise<Accepted> {
  return publish(ctx, COMMANDS.leaveAllocEnd, id, { id, reason } satisfies AllocEndPayload);
}

export async function setCustomLeaveRules(ctx: RequestContext, enabled: boolean): Promise<Accepted> {
  return publish(ctx, COMMANDS.leaveCustomRulesSet, ctx.tenantId, { enabled });
}
