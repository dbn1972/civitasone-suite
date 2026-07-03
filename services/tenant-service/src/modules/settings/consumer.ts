/**
 * Settings consumer — the ONLY code that writes Postgres for settings.
 * idempotency-check → apply write + outbox → refresh cache.
 */
import type { Queue } from "@civitasone/queue";
import { db } from "../../shared/db.js";
import { cache } from "../../shared/infra.js";
import { enqueue, markProcessed } from "../../shared/outbox.js";
import { COMMANDS, EVENTS } from "../../topics.js";
import * as repo from "./repo.js";

const AUDIT_TOPIC = "audit.event.record";
const RESOURCE = "setting";

function keyFor(tenantId: string, key: string) { return cache.makeKey(tenantId, RESOURCE, key); }

export function registerSettingConsumers(queue: Queue): void {
  queue.subscribe<{ id: string; tenantId: string; key: string; value: unknown }>(
    COMMANDS.settingUpsert,
    async (msg) => {
      await db.transaction(async (tx) => {
        if (!(await markProcessed(tx, msg.messageId))) return;
        const p = msg.payload;
        const existing = await repo.findByTenantAndKeyTx(tx as unknown as repo.Writer, p.tenantId, p.key);
        if (existing) {
          await repo.update(tx as unknown as repo.Writer, existing.id, {
            value: p.value,
            updatedBy: msg.actorId,
            version: existing.version + 1,
          });
        } else {
          await repo.insert(tx as unknown as repo.Writer, {
            id: p.id,
            tenantId: p.tenantId,
            key: p.key,
            value: p.value,
            createdBy: msg.actorId,
            updatedBy: msg.actorId,
            version: 1,
          });
        }
        await emit(tx, msg, EVENTS.settingUpserted, { tenantId: p.tenantId, key: p.key }, "upsert", p.id);
      });
      await cache.invalidate(keyFor(msg.payload.tenantId, msg.payload.key));
    },
  );

  queue.subscribe<{ tenantId: string; key: string }>(
    COMMANDS.settingDelete,
    async (msg) => {
      await db.transaction(async (tx) => {
        if (!(await markProcessed(tx, msg.messageId))) return;
        const p = msg.payload;
        await repo.deleteByTenantAndKey(tx as unknown as repo.Writer, p.tenantId, p.key);
        await emit(tx, msg, EVENTS.settingDeleted, { tenantId: p.tenantId, key: p.key }, "delete", p.key);
      });
      await cache.invalidate(keyFor(msg.payload.tenantId, msg.payload.key));
    },
  );
}

/** Enqueue domain event + mandatory audit event. */
async function emit(
  tx: unknown,
  msg: { tenantId: string; actorId: string; correlationId: string },
  eventType: string,
  payload: Record<string, unknown>,
  action: string,
  resourceId: string,
): Promise<void> {
  const t = tx as Parameters<typeof enqueue>[0];
  await enqueue(t, {
    topic: eventType, eventType, tenantId: msg.tenantId, actorId: msg.actorId,
    correlationId: msg.correlationId, payload,
  });
  await enqueue(t, {
    topic: AUDIT_TOPIC, eventType: AUDIT_TOPIC, tenantId: msg.tenantId, actorId: msg.actorId,
    correlationId: msg.correlationId,
    payload: { service: "tenant", action, resourceType: "setting", resourceId, outcome: "success" },
  });
}
