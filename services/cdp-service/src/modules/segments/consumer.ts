/**
 * segments/consumer.ts — CDP-005 handler for cdp.segment.compute.
 *
 * The recompute itself is NOT done here. POST /v1/cdp/segments/:id/compute materialises
 * membership synchronously and returns the count, because a caller that gets a count back
 * must be given the real one. Re-running `recompute` here would be a second authoritative
 * write of the same data.
 *
 * What is genuinely asynchronous is the fan-out the route defers: an activation run that
 * has not been dispatched yet holds an audience snapshot taken when it was queued, and a
 * recompute makes that snapshot wrong. Refreshing it is this handler's whole job.
 */
import type { CommandEnvelope, Queue } from "@civitasone/queue";
import { z } from "zod";
import { pino } from "pino";
import { db } from "../../shared/db.js";
import { enqueue, markProcessed } from "../../shared/outbox.js";
import { COMMANDS, EVENTS } from "../../topics.js";
import { writeAudit } from "../../shared/audit.js";
import { tenantScoped } from "../../shared/tenant-queue.js";
import * as repo from "./repo.js";
import * as activationsRepo from "../activations/repo.js";

const log = pino({ name: "cdp-segments-consumer", level: process.env.LOG_LEVEL ?? "info" });

const AUDIT_TOPIC = "audit.event.record";

const payloadSchema = z.object({
  segmentId: z.string().uuid(),
  memberCount: z.number().int().min(0),
  computedAt: z.string().datetime().optional(),
});

export type ComputeSegmentPayload = z.infer<typeof payloadSchema>;

export async function handleComputeSegment(msg: CommandEnvelope<unknown>): Promise<void> {
  const parsed = payloadSchema.safeParse(msg.payload);
  if (!parsed.success) {
    log.warn(
      { messageId: msg.messageId, tenantId: msg.tenantId, outcome: "skipped_invalid_payload", issues: parsed.error.issues.map((i) => i.path.join(".")) },
      "segment compute payload rejected",
    );
    return;
  }
  const p = parsed.data;

  // An archived or deleted segment has no live activations worth refreshing, and acting
  // on one would resurrect a count for an audience nobody may send to.
  const segment = await repo.findById(p.segmentId, msg.tenantId);
  if (!segment) {
    log.warn(
      { messageId: msg.messageId, tenantId: msg.tenantId, segmentId: p.segmentId, outcome: "skipped_unknown_segment" },
      "segment compute segment not found",
    );
    return;
  }

  let refreshed: string[] = [];

  await db.transaction(async (tx) => {
    // Idempotency gate — first statement. Without it a redelivery would bump `version`
    // on every pending activation a second time.
    const fresh = await markProcessed(tx, msg.messageId);
    if (!fresh) return;

    refreshed = await activationsRepo.refreshPendingAudience(tx, msg.tenantId, p.segmentId, p.memberCount);
    if (refreshed.length === 0) return;

    await enqueue(tx, {
      topic: EVENTS.activationAudienceRefreshed,
      eventType: EVENTS.activationAudienceRefreshed,
      tenantId: msg.tenantId,
      actorId: msg.actorId,
      correlationId: msg.correlationId,
      payload: { segmentId: p.segmentId, memberCount: p.memberCount, activationIds: refreshed },
    });

    await enqueue(tx, {
      topic: AUDIT_TOPIC,
      eventType: AUDIT_TOPIC,
      tenantId: msg.tenantId,
      actorId: msg.actorId,
      correlationId: msg.correlationId,
      payload: {
        service: "cdp",
        action: "activation_audience_refreshed",
        resourceType: "segment",
        resourceId: p.segmentId,
        outcome: "success",
        metadata: { memberCount: p.memberCount, activationIds: refreshed },
      },
    });
  });

  // Nothing to invalidate: `segment_members` was already invalidated by the route that
  // did the recompute, and activation reads go straight to Postgres (uncached).
  log.info(
    { messageId: msg.messageId, tenantId: msg.tenantId, segmentId: p.segmentId, refreshed: refreshed.length, outcome: "processed" },
    "segment compute fan-out complete",
  );
}

function ctxOf(msg: { tenantId: string; actorId: string; correlationId: string }) {
  return { tenantId: msg.tenantId, actorId: msg.actorId, correlationId: msg.correlationId };
}

export function registerSegmentConsumers(rawQueue: Queue): void {
  const queue = tenantScoped(rawQueue);

  queue.subscribe(COMMANDS.createSegment, async (msg) => {
    const p = msg.payload as {
      id: string;
      tenantId: string;
      name: string;
      description: string | null;
      segmentType: string;
      criteria: Record<string, unknown>;
    };
    await db.transaction(async (tx) => {
      if (!(await markProcessed(tx, msg.messageId))) return;
      await repo.insert(tx, {
        id: p.id,
        tenantId: msg.tenantId,
        name: p.name,
        description: p.description,
        segmentType: p.segmentType,
        criteria: p.criteria,
        status: "active",
        createdBy: msg.actorId,
        updatedBy: msg.actorId,
      });
      await enqueue(tx, {
        topic: EVENTS.segmentCreated,
        eventType: EVENTS.segmentCreated,
        tenantId: msg.tenantId,
        actorId: msg.actorId,
        correlationId: msg.correlationId,
        payload: { segmentId: p.id, name: p.name, segmentType: p.segmentType },
      });
      await writeAudit(tx, ctxOf(msg), { action: "segment.create", resourceType: "segment", resourceId: p.id });
    });
    log.info({ id: p.id }, "segment created");
  });

  queue.subscribe(COMMANDS.updateSegment, async (msg) => {
    const p = msg.payload as { id: string; tenantId: string; version: number; patch: Record<string, unknown> };
    await db.transaction(async (tx) => {
      if (!(await markProcessed(tx, msg.messageId))) return;
      const ok = await repo.update(tx, p.id, msg.tenantId, p.patch, p.version);
      if (!ok) return;
      await enqueue(tx, {
        topic: EVENTS.segmentUpdated,
        eventType: EVENTS.segmentUpdated,
        tenantId: msg.tenantId,
        actorId: msg.actorId,
        correlationId: msg.correlationId,
        payload: { segmentId: p.id, patch: p.patch },
      });
      await writeAudit(tx, ctxOf(msg), {
        action: "segment.update",
        resourceType: "segment",
        resourceId: p.id,
        details: { fields: Object.keys(p.patch) },
      });
    });
  });

  queue.subscribe(COMMANDS.deleteSegment, async (msg) => {
    const p = msg.payload as { id: string; tenantId: string; version: number };
    await db.transaction(async (tx) => {
      if (!(await markProcessed(tx, msg.messageId))) return;
      const ok = await repo.softDelete(tx, p.id, msg.tenantId, p.version);
      if (!ok) return;
      await enqueue(tx, {
        topic: EVENTS.segmentDeleted,
        eventType: EVENTS.segmentDeleted,
        tenantId: msg.tenantId,
        actorId: msg.actorId,
        correlationId: msg.correlationId,
        payload: { segmentId: p.id },
      });
      await writeAudit(tx, ctxOf(msg), { action: "segment.delete", resourceType: "segment", resourceId: p.id });
    });
  });

  queue.subscribe(COMMANDS.computeSegment, handleComputeSegment);
}
