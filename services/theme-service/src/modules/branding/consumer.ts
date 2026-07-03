import type { Queue, CommandEnvelope } from "@civitasone/queue";
import { db } from "../../shared/db.js";
import { cache } from "../../shared/infra.js";
import { enqueue, markProcessed } from "../../shared/outbox.js";
import { COMMANDS, EVENTS } from "../../topics.js";
import * as repo from "./repo.js";
import type { TenantBrandingView } from "./schema.js";

const AUDIT_TOPIC = "audit.event.record";
const RESOURCE = "branding";

function keyFor(tenantId: string, id: string) {
  return cache.makeKey(tenantId, RESOURCE, id);
}

export function registerBrandingConsumers(queue: Queue): void {
  queue.subscribe<TenantBrandingView>(COMMANDS.upsertBranding, async (msg) => {
    await db.transaction(async (tx) => {
      if (!(await markProcessed(tx, msg.messageId))) return;
      const p = msg.payload;
      await repo.upsert(tx, {
        id: p.id,
        tenantId: p.tenantId,
        logoS3Key: p.logoS3Key,
        faviconS3Key: p.faviconS3Key,
        appName: p.appName,
        primaryColor: p.primaryColor,
        accentColor: p.accentColor,
        footerText: p.footerText,
        createdBy: msg.actorId,
        updatedBy: msg.actorId,
        version: 1,
      });
      await emit(tx, msg, EVENTS.brandingUpserted, { brandingId: p.id, tenantId: p.tenantId }, "upsert", p.id);
    });
    await cache.put(keyFor(msg.tenantId, msg.payload.id), msg.payload);
    await cache.invalidateResource(msg.tenantId, RESOURCE);
  });
}

async function emit(tx: unknown, msg: CommandEnvelope, eventType: string, payload: Record<string, unknown>, action: string, resourceId: string): Promise<void> {
  const t = tx as Parameters<typeof enqueue>[0];
  await enqueue(t, { topic: eventType, eventType, tenantId: msg.tenantId, actorId: msg.actorId, correlationId: msg.correlationId, payload });
  await enqueue(t, { topic: AUDIT_TOPIC, eventType: AUDIT_TOPIC, tenantId: msg.tenantId, actorId: msg.actorId, correlationId: msg.correlationId, payload: { service: "themes", action, resourceType: "branding", resourceId, outcome: "success" } });
}
