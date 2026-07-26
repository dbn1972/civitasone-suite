import type { Queue, CommandEnvelope } from "@civitasone/queue";
import { withTenantConsumer } from "@civitasone/db";
import { db } from "../../shared/db.js";
import { cache } from "../../shared/infra.js";
import { enqueue, markProcessed } from "../../shared/outbox.js";
import * as repo from "./repo.js";

const AUDIT_TOPIC = "audit.event.record";
export const INFRA_CREATE = "location.infrastructure.create";

type CreatePayload = {
  id: string; tenantId: string; name: string; type: string; lat: number; lng: number;
  capacity?: string | null; conditionScore?: number | null;
};

/**
 * SVC-114: real persistence for the geospatial asset registry. The route
 * publishes; this consumer persists (idempotent, tenant-GUC tx) so RLS applies.
 */
export function registerInfrastructureConsumers(queue: Queue): void {
  queue.subscribe<CreatePayload>(INFRA_CREATE, withTenantConsumer(async (msg) => {
    await db.transaction(async (tx) => {
      if (!(await markProcessed(tx, msg.messageId))) return;
      const p = msg.payload;
      await repo.insert(tx, {
        id: p.id,
        tenantId: p.tenantId,
        name: p.name,
        type: p.type,
        lat: String(p.lat),
        lng: String(p.lng),
        capacity: p.capacity ?? null,
        conditionScore: p.conditionScore ?? null,
        status: "active",
        createdBy: msg.actorId,
        version: 1,
      });
      await emit(tx, msg, "location.infrastructure.registered", { assetId: p.id, name: p.name, type: p.type }, "create", p.id);
    });
    await cache.invalidate(cache.makeKey(msg.tenantId, "infrastructure", "list"));
  }));
}

async function emit(
  tx: unknown, msg: CommandEnvelope, eventType: string, payload: Record<string, unknown>,
  action: string, resourceId: string,
): Promise<void> {
  const t = tx as Parameters<typeof enqueue>[0];
  await enqueue(t, { topic: eventType, eventType, tenantId: msg.tenantId, actorId: msg.actorId, correlationId: msg.correlationId, payload });
  await enqueue(t, {
    topic: AUDIT_TOPIC, eventType: AUDIT_TOPIC, tenantId: msg.tenantId, actorId: msg.actorId, correlationId: msg.correlationId,
    payload: { service: "location", action, resourceType: "infrastructure_asset", resourceId, outcome: "success" },
  });
}
