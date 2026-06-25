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

// Revoke-all (P0 security): enqueue a single command carrying the target user.
// The consumer enumerates + revokes that user's active sessions inside one
// transaction and emits the audit via the outbox. Returns the userId as the
// accepted resource id so the caller can correlate.
export async function revokeAllSessions(ctx: RequestContext, userId: string): Promise<Accepted> {
  await queue.publish(COMMANDS.revokeAllSessions, {
    messageId: randomUUID(),
    type: COMMANDS.revokeAllSessions, tenantId: ctx.tenantId, actorId: ctx.actorId,
    correlationId: ctx.correlationId, schemaVersion: "1.0", payload: { userId },
  });
  // The session list cache for this tenant is rebuilt on next read; invalidate
  // the per-user/listing keys so a refresh reflects the revocations.
  await cache.invalidate(cache.makeKey(ctx.tenantId, RESOURCE.session, `list:50`));
  return { id: userId, status: "accepted", correlationId: ctx.correlationId };
}
