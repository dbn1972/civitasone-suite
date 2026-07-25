import { randomUUID } from "node:crypto";
import type { Queue } from "@civitasone/queue";
import { NonRetryableError } from "@civitasone/queue";
import { db } from "../../shared/db.js";
import { cache } from "../../shared/infra.js";
import { enqueue, markProcessed } from "../../shared/outbox.js";
import { COMMANDS, EVENTS } from "../../topics.js";
import { shouldFlushBySize } from "./domain.js";
import { digestRules, digestBuckets } from "./schema.js";
import * as repo from "./repo.js";
import { tenantScoped } from "../../shared/tenant-queue.js";

const AUDIT_TOPIC = "audit.event.record";

export function registerDigestConsumers(q: Queue): void {
  // RLS (#146): every handler must run inside the message's tenant context.
  q = tenantScoped(q);
  // Create a new digest rule
  q.subscribe<{
    id: string; tenantId: string; eventType: string; channel: string;
    accumulationWindowMinutes: number; maxBatchSize?: number; digestTemplateId: string;
  }>(COMMANDS.createDigestRule, async (msg) => {
    await db.transaction(async (tx) => {
      if (!(await markProcessed(tx, msg.messageId))) return;
      const p = msg.payload;

      if (p.accumulationWindowMinutes < 5 || p.accumulationWindowMinutes > 1440) {
        throw new NonRetryableError("INVALID_WINDOW", "accumulationWindowMinutes must be between 5 and 1440");
      }

      await tx.insert(digestRules).values({
        id: p.id,
        tenantId: p.tenantId,
        eventType: p.eventType,
        channel: p.channel,
        accumulationWindowMinutes: p.accumulationWindowMinutes,
        maxBatchSize: p.maxBatchSize ?? 50,
        digestTemplateId: p.digestTemplateId,
        enabled: true,
        createdBy: msg.actorId,
        updatedBy: msg.actorId,
        version: 1,
      });

      await enqueue(tx, {
        topic: AUDIT_TOPIC,
        eventType: AUDIT_TOPIC,
        tenantId: p.tenantId,
        actorId: msg.actorId,
        correlationId: msg.correlationId,
        payload: { service: "notification", action: "create_digest_rule", resourceType: "digest_rule", resourceId: p.id, outcome: "success" },
      });
    });
    await cache.invalidate(cache.makeKey(msg.tenantId, "digest_rules_list", msg.tenantId));
  });

  // Update a digest rule
  q.subscribe<{
    id: string; tenantId: string; accumulationWindowMinutes?: number;
    maxBatchSize?: number; digestTemplateId?: string; enabled?: boolean;
  }>(COMMANDS.updateDigestRule, async (msg) => {
    await db.transaction(async (tx) => {
      if (!(await markProcessed(tx, msg.messageId))) return;
      const p = msg.payload;

      if (p.accumulationWindowMinutes !== undefined && (p.accumulationWindowMinutes < 5 || p.accumulationWindowMinutes > 1440)) {
        throw new NonRetryableError("INVALID_WINDOW", "accumulationWindowMinutes must be between 5 and 1440");
      }

      const { eq, and } = await import("drizzle-orm");
      const set: Record<string, unknown> = { updatedAt: new Date(), updatedBy: msg.actorId };
      if (p.accumulationWindowMinutes !== undefined) set.accumulationWindowMinutes = p.accumulationWindowMinutes;
      if (p.maxBatchSize !== undefined) set.maxBatchSize = p.maxBatchSize;
      if (p.digestTemplateId !== undefined) set.digestTemplateId = p.digestTemplateId;
      if (p.enabled !== undefined) set.enabled = p.enabled;

      await tx.update(digestRules).set(set)
        .where(and(eq(digestRules.id, p.id), eq(digestRules.tenantId, p.tenantId)));

      await enqueue(tx, {
        topic: AUDIT_TOPIC,
        eventType: AUDIT_TOPIC,
        tenantId: p.tenantId,
        actorId: msg.actorId,
        correlationId: msg.correlationId,
        payload: { service: "notification", action: "update_digest_rule", resourceType: "digest_rule", resourceId: p.id, outcome: "success" },
      });
    });
    await cache.invalidate(cache.makeKey(msg.tenantId, "digest_rules_list", msg.tenantId));
  });

  // Flush a digest bucket — deliver accumulated notifications
  q.subscribe<{ bucketId: string; tenantId: string }>(
    COMMANDS.flushDigest, async (msg) => {
      await db.transaction(async (tx) => {
        if (!(await markProcessed(tx, msg.messageId))) return;
        const p = msg.payload;
        const { eq, and } = await import("drizzle-orm");

        const rows = await tx.select().from(digestBuckets)
          .where(and(
            eq(digestBuckets.id, p.bucketId),
            eq(digestBuckets.tenantId, p.tenantId),
            eq(digestBuckets.status, "accumulating"),
          ))
          .limit(1);

        if (!rows[0]) return; // Already flushed — idempotent

        const bucket = rows[0];

        // Mark bucket as flushed
        await tx.update(digestBuckets).set({
          status: "flushed",
          updatedAt: new Date(),
          updatedBy: msg.actorId,
        }).where(eq(digestBuckets.id, p.bucketId));

        await enqueue(tx, {
          topic: EVENTS.digestFlushed,
          eventType: EVENTS.digestFlushed,
          tenantId: p.tenantId,
          actorId: msg.actorId,
          correlationId: msg.correlationId,
          payload: { bucketId: p.bucketId, itemCount: bucket.itemCount, recipient: bucket.recipient },
        });
        await enqueue(tx, {
          topic: AUDIT_TOPIC,
          eventType: AUDIT_TOPIC,
          tenantId: p.tenantId,
          actorId: msg.actorId,
          correlationId: msg.correlationId,
          payload: { service: "notification", action: "flush_digest", resourceType: "digest_bucket", resourceId: p.bucketId, outcome: "success" },
        });
      });
    },
  );
}
