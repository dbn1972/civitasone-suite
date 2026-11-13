import { randomUUID } from "node:crypto";
import type { RequestContext } from "@civitasone/types";
import { queue } from "../../shared/infra.js";
import { COMMANDS } from "../../topics.js";
import type { UpdateLeaveTypeBody } from "./type-admin-validators.js";
import type { LeaveTypeImpact } from "./type-admin-repo.js";

export type Accepted = { id: string; status: string; correlationId: string };

export interface LeaveTypeUpdatePayload { id: string; changes: Omit<UpdateLeaveTypeBody, "expectedVersion"> }
export type ChangeAction = "deactivate" | "end_allocation" | "reinstate_allocation";
export interface LeaveTypeChangeRequestPayload {
  id: string; leaveTypeId: string; allocId?: string; action: ChangeAction; reason: string; impact: Record<string, unknown>;
}
export interface LeaveTypeChangeDecidePayload { requestId: string; decision: "approve" | "reject"; note: string | null }

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
  return publish(ctx, COMMANDS.leaveTypeChangeRequest, id, { id, leaveTypeId, action: "deactivate", reason, impact: { ...impact } } satisfies LeaveTypeChangeRequestPayload);
}

export async function decideLeaveTypeChange(ctx: RequestContext, requestId: string, decision: "approve" | "reject", note: string | null): Promise<Accepted> {
  return publish(ctx, COMMANDS.leaveTypeChangeDecide, requestId, { requestId, decision, note } satisfies LeaveTypeChangeDecidePayload);
}

export async function reactivateLeaveType(ctx: RequestContext, id: string): Promise<Accepted> {
  return publish(ctx, COMMANDS.leaveTypeReactivate, id, { id });
}

/** Maker step for ending / reinstating ONE allocation; a different admin decides it via the change-request routes. */
export async function requestAllocationChange(
  ctx: RequestContext, allocId: string, leaveTypeId: string, action: "end_allocation" | "reinstate_allocation",
  reason: string, impact: Record<string, unknown>,
): Promise<Accepted> {
  const id = randomUUID();
  return publish(ctx, COMMANDS.leaveTypeChangeRequest, id, { id, leaveTypeId, allocId, action, reason, impact } satisfies LeaveTypeChangeRequestPayload);
}

export async function setCustomLeaveRules(ctx: RequestContext, enabled: boolean): Promise<Accepted> {
  return publish(ctx, COMMANDS.leaveCustomRulesSet, ctx.tenantId, { enabled });
}
