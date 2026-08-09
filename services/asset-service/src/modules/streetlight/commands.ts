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

export function createStreetlight(ctx: CmdCtx, data: Record<string, unknown>) {
  const id = randomUUID();
  return publish(COMMANDS.streetlightCreate, ctx, { id, tenantId: ctx.tenantId, ...data });
}

export function updateStreetlightStatus(ctx: CmdCtx, streetlightId: string, status: string) {
  return publish(COMMANDS.streetlightStatusUpdate, ctx, { id: streetlightId, tenantId: ctx.tenantId, status });
}

export function reportFault(ctx: CmdCtx, data: Record<string, unknown>) {
  const id = randomUUID();
  return publish(COMMANDS.streetlightFaultReport, ctx, { id, tenantId: ctx.tenantId, ...data });
}

export function assignFault(ctx: CmdCtx, faultId: string, assignedTo: string) {
  return publish(COMMANDS.streetlightFaultAssign, ctx, { id: faultId, tenantId: ctx.tenantId, assignedTo });
}

export function resolveFault(ctx: CmdCtx, faultId: string, resolution: string) {
  return publish(COMMANDS.streetlightFaultResolve, ctx, { id: faultId, tenantId: ctx.tenantId, resolution });
}

export function createRequest(ctx: CmdCtx, data: Record<string, unknown>) {
  const id = randomUUID();
  return publish(COMMANDS.streetlightRequestCreate, ctx, { id, tenantId: ctx.tenantId, ...data });
}

export function surveyRequest(ctx: CmdCtx, requestId: string, surveyReport: unknown) {
  return publish(COMMANDS.streetlightRequestSurvey, ctx, { id: requestId, tenantId: ctx.tenantId, surveyReport });
}

export function approveRequest(ctx: CmdCtx, requestId: string) {
  return publish(COMMANDS.streetlightRequestApprove, ctx, { id: requestId, tenantId: ctx.tenantId });
}
