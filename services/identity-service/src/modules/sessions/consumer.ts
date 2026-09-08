import type { Queue, CommandEnvelope } from "@civitasone/queue";
import { denylistSession } from "@civitasone/auth/denylist";
import { db } from "../../shared/db.js";
import { cache } from "../../shared/infra.js";
import { enqueue, markProcessed } from "../../shared/outbox.js";
import { COMMANDS, EVENTS, RESOURCE } from "../../topics.js";
import * as repo from "./repo.js";

const AUDIT_TOPIC = "audit.event.record";

export function registerSessionConsumers(q: Queue): void {
  q.subscribe<{ id: string; tenantId: string; userId: string; ip: string; device: string | null; mfaMethod: string | null; trusted: boolean; expiresAt: string }>(
    COMMANDS.createSession, async (msg) => {
      await db.transaction(async (tx) => {
        if (!(await markProcessed(tx, msg.messageId))) return;
        const p = msg.payload;
        await repo.insert(tx, {
          id: p.id, tenantId: p.tenantId, userId: p.userId, ip: p.ip,
          device: p.device ?? null, mfaMethod: p.mfaMethod ?? null, trusted: p.trusted,
          status: "active", expiresAt: new Date(p.expiresAt),
          createdBy: msg.actorId, updatedBy: msg.actorId, version: 1,
        });
        await emitAudit(tx, msg, EVENTS.sessionCreated, { sessionId: p.id, userId: p.userId }, "create", p.id);
      });
    }
  );

  q.subscribe<{ id: string }>(COMMANDS.revokeSession, async (msg) => {
    await db.transaction(async (tx) => {
      if (!(await markProcessed(tx, msg.messageId))) return;
      const cur = await repo.findByIdTx(tx, msg.tenantId, msg.payload.id);
      if (!cur) return;
      await repo.update(tx, msg.tenantId, msg.payload.id, { status: "revoked", updatedBy: msg.actorId, version: cur.version + 1 });
      await emitAudit(tx, msg, EVENTS.sessionRevoked, { sessionId: msg.payload.id }, "revoke", msg.payload.id);
    });
    await cache.invalidate(cache.makeKey(msg.tenantId, RESOURCE.session, msg.payload.id));
    // SEC-006: this session's id doubles as the JWT `sid` this system tracks
    // (see the auth package's denylist.ts and the PR description for the
    // caveat on how that identifier is populated today). Denylisting here —
    // right where the row is flipped, not just when the DB write happens to
    // find a row — means a repeat revoke of an already-revoked/unknown id is
    // still denied, which is the safer default for a security control.
    await denylistSession(msg.payload.id);
  });

  q.subscribe<{ userId: string }>(COMMANDS.revokeAllSessions, async (msg) => {
    let revokedIds: string[] = [];
    await db.transaction(async (tx) => {
      if (!(await markProcessed(tx, msg.messageId))) return;
      revokedIds = await repo.revokeAllForUser(tx, msg.tenantId, msg.payload.userId, msg.actorId);
      // Emit one aggregate audit event recording the bulk revoke + count. A
      // zero-count revoke (no active sessions) is still audited as a successful
      // admin action so the attempt is on the record.
      await emitAudit(
        tx, msg, EVENTS.sessionRevokedAll,
        { userId: msg.payload.userId, revokedCount: revokedIds.length, sessionIds: revokedIds },
        "revoke_all", msg.payload.userId,
      );
    });
    // Invalidate each revoked session's cache entry so reads never serve a stale
    // "active" view, and denylist its token (SEC-006).
    for (const id of revokedIds) {
      await cache.invalidate(cache.makeKey(msg.tenantId, RESOURCE.session, id));
      await denylistSession(id);
    }
  });
}

async function emitAudit(tx: unknown, msg: CommandEnvelope, eventType: string, payload: Record<string, unknown>, action: string, resourceId: string): Promise<void> {
  const t = tx as Parameters<typeof enqueue>[0];
  await enqueue(t, { topic: eventType, eventType, tenantId: msg.tenantId, actorId: msg.actorId, correlationId: msg.correlationId, payload });
  await enqueue(t, {
    topic: AUDIT_TOPIC, eventType: AUDIT_TOPIC, tenantId: msg.tenantId, actorId: msg.actorId,
    correlationId: msg.correlationId,
    payload: { service: "identity", action, resourceType: "session", resourceId, outcome: "success" },
  });
}
