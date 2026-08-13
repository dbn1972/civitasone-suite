import { randomUUID } from "node:crypto";
import { queue } from "../../shared/infra.js";
import { COMMANDS } from "../../topics.js";

interface CmdCtx { tenantId: string; actorId: string; correlationId: string }

function publish(type: string, ctx: CmdCtx, payload: Record<string, unknown>) {
  const messageId = randomUUID();
  return queue.publish(type, {
    messageId, type, tenantId: ctx.tenantId, actorId: ctx.actorId,
    correlationId: ctx.correlationId, schemaVersion: "1.0", payload,
  }).then(() => ({ id: payload.id as string, status: "accepted" as const, correlationId: ctx.correlationId }));
}

export function createApplication(ctx: CmdCtx, data: Record<string, unknown>) {
  const id = randomUUID();
  return publish(COMMANDS.waterApplicationCreate, ctx, { id, tenantId: ctx.tenantId, ...data });
}

export function submitApplication(ctx: CmdCtx, applicationId: string) {
  return publish(COMMANDS.waterApplicationSubmit, ctx, { id: applicationId, tenantId: ctx.tenantId });
}

export function recordFeasibility(ctx: CmdCtx, applicationId: string, report: unknown) {
  return publish(COMMANDS.waterFeasibilityRecord, ctx, { id: applicationId, tenantId: ctx.tenantId, feasibilityReport: report });
}

export function approveApplication(ctx: CmdCtx, applicationId: string) {
  return publish(COMMANDS.waterApplicationApprove, ctx, { id: applicationId, tenantId: ctx.tenantId });
}

export function rejectApplication(ctx: CmdCtx, applicationId: string, reason: string) {
  return publish(COMMANDS.waterApplicationReject, ctx, { id: applicationId, tenantId: ctx.tenantId, reason });
}

export function installConnection(ctx: CmdCtx, applicationId: string, data: Record<string, unknown>) {
  const id = randomUUID();
  return publish(COMMANDS.waterConnectionInstall, ctx, { id, applicationId, tenantId: ctx.tenantId, ...data });
}

export function activateConnection(ctx: CmdCtx, connectionId: string) {
  return publish(COMMANDS.waterConnectionActivate, ctx, { id: connectionId, tenantId: ctx.tenantId });
}
