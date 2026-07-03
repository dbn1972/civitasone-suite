/**
 * Feature flags consumer — the ONLY code that writes Postgres for feature flags.
 * idempotency-check → apply write + outbox → refresh cache.
 */
import { pino } from "pino";
import type { Queue } from "@civitasone/queue";
import { db } from "../../shared/db.js";
import { cache } from "../../shared/infra.js";
import { enqueue, markProcessed } from "../../shared/outbox.js";
import { COMMANDS } from "../../topics.js";
import { featureFlags } from "./schema.js";
import { eq, and } from "drizzle-orm";

const log = pino({ name: "admin-feature-flags-consumer" });
const AUDIT_TOPIC = "audit.event.record";
const RESOURCE = "feature_flag";

function cacheKey(tenantId: string) { return cache.makeKey(tenantId, RESOURCE, "list"); }

export function registerFeatureFlagConsumers(queue: Queue): void {
  queue.subscribe<{
    id: string; tenantId: string; key: string; name: string;
    description: string; enabled: boolean; rolloutPercent: number; targetSegments: string[];
  }>(COMMANDS.featureFlagCreate, async (msg) => {
    try {
      await db.transaction(async (tx) => {
        if (!(await markProcessed(tx, msg.messageId))) return;
        const p = msg.payload;
        await (tx as any).insert(featureFlags).values({
          id: p.id,
          tenantId: p.tenantId,
          key: p.key,
          name: p.name,
          description: p.description,
          enabled: p.enabled,
          rolloutPercent: p.rolloutPercent,
          targetSegments: p.targetSegments,
          killSwitch: false,
          createdBy: msg.actorId,
          updatedBy: msg.actorId,
          version: 1,
        });
        await emit(tx, msg, "admin.feature_flag.created", p, "create", p.id);
      });
      await cache.invalidate(cacheKey(msg.payload.tenantId));
    } catch (err) {
      log.error({ err, messageId: msg.messageId, type: COMMANDS.featureFlagCreate }, "Consumer processing failed");
    }
  });

  queue.subscribe<{
    flagId: string; tenantId: string; name?: string; description?: string;
    enabled?: boolean; rolloutPercent?: number; targetSegments?: string[];
  }>("admin.feature_flag.update", async (msg) => {
    try {
      await db.transaction(async (tx) => {
        if (!(await markProcessed(tx, msg.messageId))) return;
        const p = msg.payload;
        const updates: Record<string, unknown> = { updatedBy: msg.actorId, updatedAt: new Date() };
        if (p.name !== undefined) updates.name = p.name;
        if (p.description !== undefined) updates.description = p.description;
        if (p.enabled !== undefined) updates.enabled = p.enabled;
        if (p.rolloutPercent !== undefined) updates.rolloutPercent = p.rolloutPercent;
        if (p.targetSegments !== undefined) updates.targetSegments = p.targetSegments;
        await (tx as any).update(featureFlags).set(updates)
          .where(and(eq(featureFlags.id, p.flagId), eq(featureFlags.tenantId, p.tenantId)));
        await emit(tx, msg, "admin.feature_flag.updated", p, "update", p.flagId);
      });
      await cache.invalidate(cacheKey(msg.payload.tenantId));
    } catch (err) {
      log.error({ err, messageId: msg.messageId, type: "admin.feature_flag.update" }, "Consumer processing failed");
    }
  });

  queue.subscribe<{ flagId: string; tenantId: string }>("admin.feature_flag.kill", async (msg) => {
    try {
      await db.transaction(async (tx) => {
        if (!(await markProcessed(tx, msg.messageId))) return;
        const p = msg.payload;
        await (tx as any).update(featureFlags).set({ killSwitch: true, updatedBy: msg.actorId, updatedAt: new Date() })
          .where(and(eq(featureFlags.id, p.flagId), eq(featureFlags.tenantId, p.tenantId)));
        await emit(tx, msg, "admin.feature_flag.killed", p, "kill", p.flagId);
      });
      await cache.invalidate(cacheKey(msg.payload.tenantId));
    } catch (err) {
      log.error({ err, messageId: msg.messageId, type: "admin.feature_flag.kill" }, "Consumer processing failed");
    }
  });

  queue.subscribe<{ flagId: string; tenantId: string }>("admin.feature_flag.delete", async (msg) => {
    try {
      await db.transaction(async (tx) => {
        if (!(await markProcessed(tx, msg.messageId))) return;
        const p = msg.payload;
        await (tx as any).delete(featureFlags)
          .where(and(eq(featureFlags.id, p.flagId), eq(featureFlags.tenantId, p.tenantId)));
        await emit(tx, msg, "admin.feature_flag.deleted", p, "delete", p.flagId);
      });
      await cache.invalidate(cacheKey(msg.payload.tenantId));
    } catch (err) {
      log.error({ err, messageId: msg.messageId, type: "admin.feature_flag.delete" }, "Consumer processing failed");
    }
  });
}

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
    payload: { service: "admin", action, resourceType: RESOURCE, resourceId, outcome: "success" },
  });
}
