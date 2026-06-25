/** agents command handlers (WRITE PATH). */
import { randomUUID } from "node:crypto";
import type { RequestContext } from "@civitasone/types";
import { queue, cache } from "../../shared/infra.js";
import { COMMANDS, AGENT_RESOURCE } from "../../topics.js";
import type { UpsertAgentBody, SetAgentStatusBody } from "./validators.js";

export type Accepted = { id: string; status: string; correlationId: string };

export async function upsertAgent(ctx: RequestContext, body: UpsertAgentBody): Promise<Accepted> {
  const id = randomUUID();
  await queue.publish(COMMANDS.upsertAgent, {
    messageId: id,
    type: COMMANDS.upsertAgent,
    tenantId: ctx.tenantId,
    actorId: ctx.actorId,
    correlationId: ctx.correlationId,
    schemaVersion: "1.0",
    payload: {
      id,
      tenantId: ctx.tenantId,
      userId: body.userId,
      displayName: body.displayName,
      queueId: body.queueId ?? null,
      status: body.status,
      extension: body.extension ?? null,
    },
  });
  await cache.invalidateResource(ctx.tenantId, AGENT_RESOURCE);
  return { id, status: "accepted", correlationId: ctx.correlationId };
}

export async function setAgentStatus(ctx: RequestContext, id: string, body: SetAgentStatusBody): Promise<Accepted> {
  await queue.publish(COMMANDS.setAgentStatus, {
    messageId: randomUUID(),
    type: COMMANDS.setAgentStatus,
    tenantId: ctx.tenantId,
    actorId: ctx.actorId,
    correlationId: ctx.correlationId,
    schemaVersion: "1.0",
    payload: { id, tenantId: ctx.tenantId, status: body.status, expectedVersion: body.expectedVersion },
  });
  await cache.invalidate(cache.makeKey(ctx.tenantId, AGENT_RESOURCE, id));
  await cache.invalidateResource(ctx.tenantId, AGENT_RESOURCE);
  return { id, status: "accepted", correlationId: ctx.correlationId };
}
