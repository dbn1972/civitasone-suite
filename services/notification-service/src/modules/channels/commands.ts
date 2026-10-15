import { randomUUID } from "node:crypto";
import type { RequestContext } from "@civitasone/types";
import { queue } from "../../shared/infra.js";
import { COMMANDS } from "../../topics.js";
import type { CreateChannelBody, SetChannelEnabledBody } from "./validators.js";

export type Accepted = { id: string; status: string; correlationId: string };

export async function setChannelEnabled(
  ctx: RequestContext, id: string, body: SetChannelEnabledBody,
): Promise<Accepted> {
  const messageId = randomUUID();
  await queue.publish(COMMANDS.setChannelEnabled, {
    messageId, type: COMMANDS.setChannelEnabled, tenantId: ctx.tenantId, actorId: ctx.actorId,
    correlationId: ctx.correlationId, schemaVersion: "1.0",
    payload: { id, tenantId: ctx.tenantId, enabled: body.enabled, ...(body.reason ? { reason: body.reason } : {}) },
  });
  return { id, status: "accepted", correlationId: ctx.correlationId };
}

export async function createChannel(ctx: RequestContext, body: CreateChannelBody): Promise<Accepted> {
  const id = randomUUID();
  await queue.publish(COMMANDS.createChannel, {
    messageId: id, type: COMMANDS.createChannel, tenantId: ctx.tenantId, actorId: ctx.actorId,
    correlationId: ctx.correlationId, schemaVersion: "1.0",
    payload: { id, tenantId: ctx.tenantId, ...body },
  });
  return { id, status: "accepted", correlationId: ctx.correlationId };
}
