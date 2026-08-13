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

export function recordReading(ctx: CmdCtx, data: Record<string, unknown>) {
  const id = randomUUID();
  return publish(COMMANDS.waterMeterReadingRecord, ctx, { id, tenantId: ctx.tenantId, ...data });
}

export function generateBill(ctx: CmdCtx, data: Record<string, unknown>) {
  const id = randomUUID();
  return publish(COMMANDS.waterBillGenerate, ctx, { id, tenantId: ctx.tenantId, ...data });
}

export function createServiceRequest(ctx: CmdCtx, data: Record<string, unknown>) {
  const id = randomUUID();
  return publish(COMMANDS.waterServiceRequestCreate, ctx, { id, tenantId: ctx.tenantId, ...data });
}

export function resolveServiceRequest(ctx: CmdCtx, requestId: string, resolution: string) {
  return publish(COMMANDS.waterServiceRequestResolve, ctx, { id: requestId, tenantId: ctx.tenantId, resolution });
}
