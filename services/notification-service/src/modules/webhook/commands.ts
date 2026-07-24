import { randomUUID } from "node:crypto";
import type { RequestContext } from "@civitasone/types";
import { queue } from "../../shared/infra.js";
import { COMMANDS } from "../../topics.js";

export type Accepted = { id: string; status: string; correlationId: string };

export interface CreateWebhookEndpointPayload {
  name: string;
  url: string;
  secret: string;
}

export interface UpdateWebhookEndpointPayload {
  name?: string;
  url?: string;
  secret?: string;
  enabled?: boolean;
}

export async function createWebhookEndpoint(ctx: RequestContext, payload: CreateWebhookEndpointPayload): Promise<Accepted> {
  const id = randomUUID();
  await queue.publish(COMMANDS.createWebhookEndpoint, {
    messageId: id, type: COMMANDS.createWebhookEndpoint, tenantId: ctx.tenantId, actorId: ctx.actorId,
    correlationId: ctx.correlationId, schemaVersion: "1.0",
    payload: { id, tenantId: ctx.tenantId, ...payload },
  });
  return { id, status: "accepted", correlationId: ctx.correlationId };
}

export async function updateWebhookEndpoint(ctx: RequestContext, id: string, payload: UpdateWebhookEndpointPayload): Promise<Accepted> {
  const messageId = randomUUID();
  await queue.publish(COMMANDS.updateWebhookEndpoint, {
    messageId, type: COMMANDS.updateWebhookEndpoint, tenantId: ctx.tenantId, actorId: ctx.actorId,
    correlationId: ctx.correlationId, schemaVersion: "1.0",
    payload: { id, tenantId: ctx.tenantId, ...payload },
  });
  return { id, status: "accepted", correlationId: ctx.correlationId };
}
