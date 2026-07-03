/**
 * Quotas consumer — the ONLY code that writes Postgres for quotas.
 * idempotency-check → apply write + outbox → refresh cache.
 */
import type { Queue } from "@civitasone/queue";
import { db } from "../../shared/db.js";
import { cache } from "../../shared/infra.js";
import { enqueue, markProcessed } from "../../shared/outbox.js";
import { COMMANDS, EVENTS } from "../../topics.js";
import * as repo from "./repo.js";
import type { QuotaResource } from "./repo.js";

const AUDIT_TOPIC = "audit.event.record";
const RESOURCE = "quota";

function keyFor(tenantId: string, resource: string) { return cache.makeKey(tenantId, RESOURCE, resource); }

export function registerQuotaConsumers(queue: Queue): void {
  queue.subscribe<{ id: string; tenantId: string; resource: QuotaResource; limit: number }>(
    COMMANDS.quotaSet,
    async (msg) => {
      await db.transaction(async (tx) => {
        if (!(await markProcessed(tx, msg.messageId))) return;
        const p = msg.payload;
        const existing = await repo.findByTenantAndResourceTx(tx as unknown as repo.Writer, p.tenantId, p.resource);
        if (existing) {
          await repo.update(tx as unknown as repo.Writer, existing.id, {
            limit: p.limit,
            updatedBy: msg.actorId,
            version: existing.version + 1,
          });
        } else {
          await repo.insert(tx as unknown as repo.Writer, {
            id: p.id,
            tenantId: p.tenantId,
            resource: p.resource,
            limit: p.limit,
            used: 0,
            createdBy: msg.actorId,
            updatedBy: msg.actorId,
            version: 1,
          });
        }
        await emit(tx, msg, EVENTS.quotaSet, { tenantId: p.tenantId, resource: p.resource, limit: p.limit }, "set", p.id);
      });
      await cache.invalidate(keyFor(msg.payload.tenantId, msg.payload.resource));
    },
  );

  queue.subscribe<{ tenantId: string; resource: QuotaResource; delta: number }>(
    COMMANDS.quotaIncrement,
    async (msg) => {
      await db.transaction(async (tx) => {
        if (!(await markProcessed(tx, msg.messageId))) return;
        const p = msg.payload;
        const existing = await repo.findByTenantAndResourceTx(tx as unknown as repo.Writer, p.tenantId, p.resource);
        if (!existing) throw new Error(`quota for ${p.tenantId}/${p.resource} not found — set quota first`);
        const newUsed = Math.max(0, existing.used + p.delta);
        await repo.update(tx as unknown as repo.Writer, existing.id, {
          used: newUsed,
          updatedBy: msg.actorId,
          version: existing.version + 1,
        });
        const overLimit = newUsed >= existing.limit;
        await emit(tx, msg, EVENTS.quotaIncremented, {
          tenantId: p.tenantId, resource: p.resource, delta: p.delta, newUsed, overLimit,
        }, "increment", existing.id);
      });
      await cache.invalidate(keyFor(msg.payload.tenantId, msg.payload.resource));
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
    payload: { service: "tenant", action, resourceType: "quota", resourceId, outcome: "success" },
  });
}
