import { randomUUID } from "node:crypto";
import type { RequestContext } from "@civitasone/types";
import { queue, cache } from "../../shared/infra.js";
import { COMMANDS, RESOURCE } from "../../topics.js";
import type { CreateSessionBody } from "./validators.js";

export type Accepted = { id: string; status: string; correlationId: string };

export async function createSession(ctx: RequestContext, body: CreateSessionBody): Promise<Accepted> {
  const id = randomUUID();
  const expiresAt = new Date(Date.now() + body.ttlSeconds * 1000).toISOString();
  await queue.publish(COMMANDS.createSession, {
    messageId: id, type: COMMANDS.createSession, tenantId: ctx.tenantId, actorId: ctx.actorId,
    correlationId: ctx.correlationId, schemaVersion: "1.0",
    payload: { id, tenantId: ctx.tenantId, userId: body.userId, ip: body.ip, device: body.device ?? null, mfaMethod: body.mfaMethod ?? null, trusted: body.trusted, expiresAt },
  });
  return { id, status: "accepted", correlationId: ctx.correlationId };
}

export async function revokeSession(ctx: RequestContext, id: string): Promise<Accepted> {
  await queue.publish(COMMANDS.revokeSession, {
    messageId: randomUUID(),
    type: COMMANDS.revokeSession, tenantId: ctx.tenantId, actorId: ctx.actorId,
    correlationId: ctx.correlationId, schemaVersion: "1.0", payload: { id },
  });
  await cache.invalidate(cache.makeKey(ctx.tenantId, RESOURCE.session, id));
  return { id, status: "accepted", correlationId: ctx.correlationId };
}
