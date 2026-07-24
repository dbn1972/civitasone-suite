import type { Queue } from "@civitasone/queue";
import { NonRetryableError } from "@civitasone/queue";
import { db } from "../../shared/db.js";
import { cache } from "../../shared/infra.js";
import { enqueue, markProcessed } from "../../shared/outbox.js";
import { COMMANDS, EVENTS } from "../../topics.js";
import { validateEndpointUrl } from "./domain.js";
import { webhookEndpoints } from "./schema.js";

const AUDIT_TOPIC = "audit.event.record";

export function registerWebhookConsumers(q: Queue): void {
  q.subscribe<{
    id: string; tenantId: string; name: string; url: string; secret: string;
  }>(COMMANDS.createWebhookEndpoint, async (msg) => {
    await db.transaction(async (tx) => {
      if (!(await markProcessed(tx, msg.messageId))) return;
      const p = msg.payload;

      if (!validateEndpointUrl(p.url)) {
        throw new NonRetryableError("INVALID_URL", "Webhook endpoint URL must use HTTPS");
      }

      await tx.insert(webhookEndpoints).values({
        id: p.id,
        tenantId: p.tenantId,
        name: p.name,
        url: p.url,
        secret: p.secret,
        enabled: true,
        createdBy: msg.actorId,
        updatedBy: msg.actorId,
        version: 1,
      });

      await enqueue(tx, {
        topic: EVENTS.webhookEndpointCreated,
        eventType: EVENTS.webhookEndpointCreated,
        tenantId: p.tenantId,
        actorId: msg.actorId,
        correlationId: msg.correlationId,
        payload: { endpointId: p.id, name: p.name },
      });
      await enqueue(tx, {
        topic: AUDIT_TOPIC,
        eventType: AUDIT_TOPIC,
        tenantId: p.tenantId,
        actorId: msg.actorId,
        correlationId: msg.correlationId,
        payload: { service: "notification", action: "create_webhook_endpoint", resourceType: "webhook_endpoint", resourceId: p.id, outcome: "success" },
      });
    });
    await cache.invalidate(cache.makeKey(msg.tenantId, "webhook_endpoints_list", msg.tenantId));
  });

  q.subscribe<{
    id: string; tenantId: string; name?: string; url?: string; secret?: string; enabled?: boolean;
  }>(COMMANDS.updateWebhookEndpoint, async (msg) => {
    await db.transaction(async (tx) => {
      if (!(await markProcessed(tx, msg.messageId))) return;
      const p = msg.payload;

      if (p.url && !validateEndpointUrl(p.url)) {
        throw new NonRetryableError("INVALID_URL", "Webhook endpoint URL must use HTTPS");
      }

      const { eq, and } = await import("drizzle-orm");
      const set: Record<string, unknown> = { updatedAt: new Date(), updatedBy: msg.actorId };
      if (p.name !== undefined) set.name = p.name;
      if (p.url !== undefined) set.url = p.url;
      if (p.secret !== undefined) set.secret = p.secret;
      if (p.enabled !== undefined) set.enabled = p.enabled;

      await tx.update(webhookEndpoints).set(set)
        .where(and(eq(webhookEndpoints.id, p.id), eq(webhookEndpoints.tenantId, p.tenantId)));

      await enqueue(tx, {
        topic: AUDIT_TOPIC,
        eventType: AUDIT_TOPIC,
        tenantId: p.tenantId,
        actorId: msg.actorId,
        correlationId: msg.correlationId,
        payload: { service: "notification", action: "update_webhook_endpoint", resourceType: "webhook_endpoint", resourceId: p.id, outcome: "success" },
      });
    });
    await cache.invalidate(cache.makeKey(msg.tenantId, "webhook_endpoints_list", msg.tenantId));
  });
}
