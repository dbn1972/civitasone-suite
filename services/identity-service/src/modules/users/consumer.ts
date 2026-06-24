import type { Queue, CommandEnvelope } from "@civitasone/queue";
import { db } from "../../shared/db.js";
import { cache } from "../../shared/infra.js";
import { enqueue, markProcessed } from "../../shared/outbox.js";
import { COMMANDS, EVENTS, RESOURCE } from "../../topics.js";
import * as repo from "./repo.js";
import { assertTransition, type UserView } from "./domain.js";

const AUDIT_TOPIC = "audit.event.record";

function keyFor(tenantId: string, id: string) {
  return cache.makeKey(tenantId, RESOURCE.user, id);
}

export function registerUserConsumers(q: Queue): void {
  q.subscribe<UserView & { createdBy: string }>(COMMANDS.createUser, async (msg) => {
    await db.transaction(async (tx) => {
      if (!(await markProcessed(tx, msg.messageId))) return;
      const p = msg.payload;
      await repo.insert(tx, {
        id: p.id, tenantId: p.tenantId, email: p.email, name: p.name,
        empCode: p.empCode ?? null, status: "active", mfaEnabled: false,
        createdBy: msg.actorId, updatedBy: msg.actorId, version: 1,
      });
      await emitAudit(tx, msg, EVENTS.userCreated, { userId: p.id }, "create", p.id);
    });
    await cache.put(keyFor(msg.payload.tenantId, msg.payload.id), msg.payload);
  });

  q.subscribe<{ id: string; name?: string; empCode?: string }>(COMMANDS.updateUser, async (msg) => {
    await db.transaction(async (tx) => {
      if (!(await markProcessed(tx, msg.messageId))) return;
      const cur = await repo.findByIdTx(tx, msg.tenantId, msg.payload.id);
      if (!cur) throw new Error(`user ${msg.payload.id} not found`);
      const patch: Record<string, unknown> = { updatedBy: msg.actorId, version: cur.version + 1 };
      if (msg.payload.name !== undefined) patch.name = msg.payload.name;
      if (msg.payload.empCode !== undefined) patch.empCode = msg.payload.empCode;
      await repo.update(tx, msg.tenantId, msg.payload.id, patch);
      await emitAudit(tx, msg, EVENTS.userUpdated, { userId: msg.payload.id }, "update", msg.payload.id);
    });
    await cache.invalidate(keyFor(msg.tenantId, msg.payload.id));
  });

  q.subscribe<{ id: string; status: string; reason?: string }>(COMMANDS.deactivateUser, async (msg) => {
    await db.transaction(async (tx) => {
      if (!(await markProcessed(tx, msg.messageId))) return;
      const cur = await repo.findByIdTx(tx, msg.tenantId, msg.payload.id);
      if (!cur) throw new Error(`user ${msg.payload.id} not found`);
      assertTransition(cur.status, msg.payload.status as UserView["status"]);
      await repo.update(tx, msg.tenantId, msg.payload.id, {
        status: msg.payload.status, updatedBy: msg.actorId, version: cur.version + 1,
      });
      await emitAudit(tx, msg, EVENTS.userDeactivated, { userId: msg.payload.id, status: msg.payload.status }, "status_change", msg.payload.id);
    });
    await cache.invalidate(keyFor(msg.tenantId, msg.payload.id));
  });
}

async function emitAudit(tx: unknown, msg: CommandEnvelope, eventType: string, payload: Record<string, unknown>, action: string, resourceId: string): Promise<void> {
  const t = tx as Parameters<typeof enqueue>[0];
  await enqueue(t, { topic: eventType, eventType, tenantId: msg.tenantId, actorId: msg.actorId, correlationId: msg.correlationId, payload });
  await enqueue(t, {
    topic: AUDIT_TOPIC, eventType: AUDIT_TOPIC, tenantId: msg.tenantId, actorId: msg.actorId,
    correlationId: msg.correlationId,
    payload: { service: "identity", action, resourceType: "user", resourceId, outcome: "success" },
  });
}
