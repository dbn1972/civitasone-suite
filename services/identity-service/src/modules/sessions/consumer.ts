import type { Queue, CommandEnvelope } from "@civitasone/queue";
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
