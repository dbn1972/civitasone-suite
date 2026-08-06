/**
 * G3 — Command publish helpers for stage-SLA policies.
 */
import type { RequestContext } from "@civitasone/types";
import { queue } from "../../shared/infra.js";
import { commandId } from "../../shared/idempotency.js";
import { COMMANDS } from "../../topics.js";

export async function publishCreateSLAPolicy(
  ctx: RequestContext,
  payload: Record<string, unknown>,
): Promise<{ id: string; correlationId: string }> {
  const msgId = commandId(ctx, `${COMMANDS.createStageSLAPolicy}:${payload.stageCode}`);
  await queue.publish(COMMANDS.createStageSLAPolicy, {
    messageId: msgId,
    type: COMMANDS.createStageSLAPolicy,
    tenantId: ctx.tenantId,
    actorId: ctx.actorId,
    correlationId: ctx.correlationId,
    schemaVersion: "1.0",
    payload: { ...payload, tenantId: ctx.tenantId },
  });
  return { id: msgId, correlationId: ctx.correlationId };
}

export async function publishUpdateSLAPolicy(
  ctx: RequestContext,
  id: string,
  payload: Record<string, unknown>,
): Promise<{ id: string; correlationId: string }> {
  const msgId = commandId(ctx, `${COMMANDS.updateStageSLAPolicy}:${id}`);
  await queue.publish(COMMANDS.updateStageSLAPolicy, {
    messageId: msgId,
    type: COMMANDS.updateStageSLAPolicy,
    tenantId: ctx.tenantId,
    actorId: ctx.actorId,
    correlationId: ctx.correlationId,
    schemaVersion: "1.0",
    payload: { ...payload, id, tenantId: ctx.tenantId },
  });
  return { id: msgId, correlationId: ctx.correlationId };
}

export async function publishDeleteSLAPolicy(
  ctx: RequestContext,
  id: string,
): Promise<{ id: string; correlationId: string }> {
  const msgId = commandId(ctx, `${COMMANDS.deleteStageSLAPolicy}:${id}`);
  await queue.publish(COMMANDS.deleteStageSLAPolicy, {
    messageId: msgId,
    type: COMMANDS.deleteStageSLAPolicy,
    tenantId: ctx.tenantId,
    actorId: ctx.actorId,
    correlationId: ctx.correlationId,
    schemaVersion: "1.0",
    payload: { id, tenantId: ctx.tenantId },
  });
  return { id: msgId, correlationId: ctx.correlationId };
}
