import type { Queue } from "@civitasone/queue";
import { eq, and, sql } from "drizzle-orm";
import { db } from "../../shared/db.js";
import { cache } from "../../shared/infra.js";
import { enqueue, markProcessed } from "../../shared/outbox.js";
import { COMMANDS, EVENTS } from "../../topics.js";
import { pluginStores } from "./schema.js";

const AUDIT_TOPIC = "audit.event.record";

function cacheKey(tenantId: string, pluginId: string, key: string) {
  return cache.makeKey(tenantId, "plugin-store", `${pluginId}:${key}`);
}

export function registerStoreConsumers(queue: Queue): void {
  queue.subscribe(COMMANDS.storePut, async (msg) => {
    const p = msg.payload as {
      tenantId: string;
      pluginId: string;
      key: string;
      value: unknown;
      sizeBytes: number;
    };
    await db.transaction(async (tx) => {
      if (!(await markProcessed(tx, msg.messageId))) return;
      const existing = await tx
        .select({ id: pluginStores.id })
        .from(pluginStores)
        .where(
          and(
            eq(pluginStores.tenantId, p.tenantId),
            eq(pluginStores.pluginId, p.pluginId),
            eq(pluginStores.key, p.key),
          ),
        );
      if (existing.length > 0) {
        await tx
          .update(pluginStores)
          .set({
            value: p.value,
            sizeBytes: p.sizeBytes,
            updatedAt: new Date(),
            updatedBy: msg.actorId,
            version: sql`${pluginStores.version} + 1`,
          })
          .where(eq(pluginStores.id, existing[0]!.id));
      } else {
        await tx.insert(pluginStores).values({
          tenantId: p.tenantId,
          pluginId: p.pluginId,
          key: p.key,
          value: p.value,
          sizeBytes: p.sizeBytes,
          createdBy: msg.actorId,
          updatedBy: msg.actorId,
        });
      }
      await enqueue(tx, {
        topic: EVENTS.storeUpdated,
        eventType: EVENTS.storeUpdated,
        tenantId: msg.tenantId,
        actorId: msg.actorId,
        correlationId: msg.correlationId,
        payload: { pluginId: p.pluginId, key: p.key, sizeBytes: p.sizeBytes },
      });
      await enqueue(tx, {
        topic: AUDIT_TOPIC,
        eventType: AUDIT_TOPIC,
        tenantId: msg.tenantId,
        actorId: msg.actorId,
        correlationId: msg.correlationId,
        payload: {
          service: "plugins",
          action: "store_put",
          resourceType: "plugin_store",
          resourceId: `${p.pluginId}:${p.key}`,
          outcome: "success",
        },
      });
    });
    await cache.invalidate(cacheKey(msg.tenantId, p.pluginId, p.key));
  });

  queue.subscribe(COMMANDS.storeDelete, async (msg) => {
    const p = msg.payload as { tenantId: string; pluginId: string; key: string };
    await db.transaction(async (tx) => {
      if (!(await markProcessed(tx, msg.messageId))) return;
      await tx
        .delete(pluginStores)
        .where(
          and(
            eq(pluginStores.tenantId, p.tenantId),
            eq(pluginStores.pluginId, p.pluginId),
            eq(pluginStores.key, p.key),
          ),
        );
      await enqueue(tx, {
        topic: EVENTS.storeDeleted,
        eventType: EVENTS.storeDeleted,
        tenantId: msg.tenantId,
        actorId: msg.actorId,
        correlationId: msg.correlationId,
        payload: { pluginId: p.pluginId, key: p.key },
      });
      await enqueue(tx, {
        topic: AUDIT_TOPIC,
        eventType: AUDIT_TOPIC,
        tenantId: msg.tenantId,
        actorId: msg.actorId,
        correlationId: msg.correlationId,
        payload: {
          service: "plugins",
          action: "store_delete",
          resourceType: "plugin_store",
          resourceId: `${p.pluginId}:${p.key}`,
          outcome: "success",
        },
      });
    });
    await cache.invalidate(cacheKey(msg.tenantId, p.pluginId, p.key));
  });
}
