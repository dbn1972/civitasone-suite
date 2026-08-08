/**
 * visitor-service: badge-print consumer.
 *
 * Handles badge printing CQRS commands following the established pattern:
 *   markProcessed(tx, msg.messageId) → DB write → outbox event
 *   → cache invalidate (post-commit, best-effort).
 *
 * Each handler operates within a single DB transaction. The outbox relay
 * publishes events after commit (transactional outbox guarantee).
 *
 * Requirements validated: 5.1, 5.2, 5.3, 5.5, 5.6, 5.8, 5.10, 11.2
 */
import { pino } from "pino";
import { and, eq } from "drizzle-orm";
import { Redis } from "ioredis";
import type { Queue } from "@civitasone/queue";
import { NOTIFICATION_SEND, buildNotificationPayload } from "@civitasone/events";
import { db } from "../../shared/db.js";
import { enqueue, markProcessed, versionedUpdate } from "../../shared/outbox.js";
import { cache } from "../../shared/infra.js";
import { COMMANDS, EVENTS } from "../../topics.js";
import { badgeTemplates, printJobs } from "./schema.js";
import { digitalPasses } from "../digital-pass/schema.js";
import { visitRequests } from "../visit-request/schema.js";
import { renderBadge, validateTemplatePlaceholders } from "./renderer.js";
import { computeJobScore, shouldRetry, computeNextRetryAt, createNewVersion } from "./domain.js";
import type { PlaceholderKey } from "./renderer.js";

const AUDIT_TOPIC = "audit.event.record";

const log = pino({ name: "badge-print-consumer" });

/** Cache resource keys for badge-print records. */
const RESOURCE_PRINT_JOB = "print_job";
const RESOURCE_BADGE_TEMPLATE = "badge_template";

// ── Redis Client for Sorted Set Operations ────────────────────────────────

let _redis: Redis | null = null;

function getRedis(): Redis | null {
  if (_redis) return _redis;
  const url = process.env.REDIS_URL;
  if (!url || process.env.CACHE_DRIVER === "memory") return null;
  _redis = new Redis(url);
  return _redis;
}

/** Build the sorted set key for a device's print job queue. */
function printerJobsKey(tenantId: string, deviceId: string): string {
  return `visitor:${tenantId}:printer:${deviceId}:jobs`;
}

// ── Payload Types ─────────────────────────────────────────────────────────

export interface PrintJobCreatePayload {
  id: string;
  tenantId: string;
  passId: string;
  deviceId: string;
  priority: "standard" | "high";
  printerLanguage: "zpl" | "escpos";
  visitorCategory: string;
}

export interface PrintJobAcknowledgePayload {
  jobId: string;
  deviceId: string;
  tenantId: string;
}

export interface PrintJobFailPayload {
  jobId: string;
  deviceId: string;
  tenantId: string;
  errorCode: string | null;
  errorMessage: string | null;
}

export interface PrintJobRetryPayload {
  jobId: string;
  deviceId: string;
  tenantId: string;
}

export interface PrintJobRequeuePayload {
  jobId: string;
  deviceId: string;
  tenantId: string;
  reason: string | null;
}

export interface BadgeTemplateCreatePayload {
  id: string;
  tenantId: string;
  name: string;
  printerLanguage: string;
  templateBody: string;
  badgeWidthMm: number;
  badgeHeightMm: number;
  visitorCategory: string;
}

export interface BadgeTemplateUpdatePayload {
  templateId: string;
  tenantId: string;
  name: string | null;
  templateBody: string | null;
  badgeWidthMm: number | null;
  badgeHeightMm: number | null;
  visitorCategory: string | null;
}

// ── Consumer Registration ─────────────────────────────────────────────────

export function registerBadgePrintConsumers(queue: Queue): void {

  // ─── printJobCreate ───────────────────────────────────────────────────
  queue.subscribe<PrintJobCreatePayload>(COMMANDS.printJobCreate, async (msg) => {
    const p = msg.payload;
    const now = new Date();

    await db.transaction(async (tx): Promise<void> => {
      if (!(await markProcessed(tx, msg.messageId))) return; // idempotent replay

      // 1. Find the matching badge template by tenant + category + printerLanguage
      const templates = await tx
        .select()
        .from(badgeTemplates)
        .where(
          and(
            eq(badgeTemplates.tenantId, msg.tenantId),
            eq(badgeTemplates.visitorCategory, p.visitorCategory),
            eq(badgeTemplates.printerLanguage, p.printerLanguage),
            eq(badgeTemplates.status, "active"),
          ),
        )
        .limit(1);
      const template = templates[0];
      if (!template) {
        throw new Error(
          `no active badge template found for tenant '${msg.tenantId}', category '${p.visitorCategory}', language '${p.printerLanguage}'`,
        );
      }

      // 2. Load digital pass + visit request for badge data
      const passes = await tx
        .select()
        .from(digitalPasses)
        .where(and(eq(digitalPasses.id, p.passId), eq(digitalPasses.tenantId, msg.tenantId)))
        .limit(1);
      const pass = passes[0];
      if (!pass) {
        throw new Error(`digital pass '${p.passId}' not found for tenant '${msg.tenantId}'`);
      }

      const requests = await tx
        .select()
        .from(visitRequests)
        .where(and(eq(visitRequests.id, pass.visitRequestId), eq(visitRequests.tenantId, msg.tenantId)))
        .limit(1);
      const request = requests[0];
      if (!request) {
        throw new Error(`visit request '${pass.visitRequestId}' not found for tenant '${msg.tenantId}'`);
      }

      // 3. Render badge template with visitor data
      const badgeData: Partial<Record<PlaceholderKey, string>> = {
        visitor_name: request.visitorName ?? "",
        host_name: request.hostEmployeeId, // ID reference — downstream enrichment by caller
        qr_code_data: pass.qrJwt,
        permitted_areas: (pass.permittedAreas ?? []).join(", "),
        valid_from: pass.validFrom.toISOString(),
        valid_until: pass.validUntil.toISOString(),
        visitor_category: request.visitorCategory,
        pass_number: pass.passNumber,
      };

      const renderedPayload = renderBadge(template.templateBody, badgeData);

      // 4. Insert print job with rendered payload
      const score = computeJobScore(p.priority, now);
      await tx.insert(printJobs).values({
        id: p.id,
        tenantId: msg.tenantId,
        deviceId: p.deviceId,
        passId: p.passId,
        templateId: template.id,
        status: "queued",
        priority: p.priority,
        renderedPayload,
        retryCount: 0,
        createdAt: now,
        updatedAt: now,
      });

      // 5. Outbox: printJobCreated event
      await enqueue(tx, {
        topic: EVENTS.printJobCreated,
        eventType: EVENTS.printJobCreated,
        tenantId: msg.tenantId,
        actorId: msg.actorId,
        correlationId: msg.correlationId,
        payload: {
          id: p.id,
          tenantId: msg.tenantId,
          deviceId: p.deviceId,
          passId: p.passId,
          templateId: template.id,
          status: "queued",
          priority: p.priority,
          score,
        },
      });
      await enqueue(tx, { topic: AUDIT_TOPIC, eventType: AUDIT_TOPIC, tenantId: msg.tenantId, actorId: msg.actorId, correlationId: msg.correlationId, payload: { service: "visitor-service", action: "create", resourceType: "print_job", resourceId: p.id, outcome: "success" } });
    });

    // Post-commit: ZADD to Redis sorted set (best-effort)
    try {
      const redis = getRedis();
      if (redis) {
        const score = computeJobScore(p.priority, now);
        await redis.zadd(printerJobsKey(msg.tenantId, p.deviceId), score, p.id);
      }
    } catch (err) {
      log.warn({ err, tenantId: msg.tenantId, jobId: p.id, event: "redis_zadd_failed" },
        "print job Redis ZADD failed after commit; device poll will fall back to DB query");
    }

    // Invalidate cache
    try {
      await cache.invalidate(cache.makeKey(msg.tenantId, RESOURCE_PRINT_JOB, p.id));
    } catch (err) {
      log.warn({ err, tenantId: msg.tenantId, jobId: p.id, event: "cache_invalidate_failed" },
        "print job cache invalidation failed after create");
    }
  });

  // ─── printJobAcknowledge ──────────────────────────────────────────────
  queue.subscribe<PrintJobAcknowledgePayload>(COMMANDS.printJobAcknowledge, async (msg) => {
    const p = msg.payload;
    const now = new Date();

    await db.transaction(async (tx): Promise<void> => {
      if (!(await markProcessed(tx, msg.messageId))) return;

      // Update print job status to completed
      const rows = await tx
        .select()
        .from(printJobs)
        .where(and(eq(printJobs.id, p.jobId), eq(printJobs.tenantId, msg.tenantId)))
        .limit(1);
      const job = rows[0];
      if (!job) {
        throw new Error(`print job '${p.jobId}' not found for tenant '${msg.tenantId}'`);
      }

      await versionedUpdate(tx, printJobs, {
        id: p.jobId,
        tenantId: msg.tenantId,
        expectedVersion: job.version,
        set: {
          status: "completed",
          completedAt: now,
          updatedAt: now,
        },
        entity: "print_job",
      });

      // Outbox: printJobCompleted event
      await enqueue(tx, {
        topic: EVENTS.printJobCompleted,
        eventType: EVENTS.printJobCompleted,
        tenantId: msg.tenantId,
        actorId: msg.actorId,
        correlationId: msg.correlationId,
        payload: {
          id: p.jobId,
          tenantId: msg.tenantId,
          deviceId: p.deviceId,
          status: "completed",
          completedAt: now.toISOString(),
        },
      });
      await enqueue(tx, { topic: AUDIT_TOPIC, eventType: AUDIT_TOPIC, tenantId: msg.tenantId, actorId: msg.actorId, correlationId: msg.correlationId, payload: { service: "visitor-service", action: "complete", resourceType: "print_job", resourceId: p.jobId, outcome: "success" } });
    });

    // Post-commit: ZREM from Redis sorted set (best-effort)
    try {
      const redis = getRedis();
      if (redis) {
        await redis.zrem(printerJobsKey(msg.tenantId, p.deviceId), p.jobId);
      }
    } catch (err) {
      log.warn({ err, tenantId: msg.tenantId, jobId: p.jobId, event: "redis_zrem_failed" },
        "print job Redis ZREM failed after acknowledge");
    }

    // Invalidate cache
    try {
      await cache.invalidate(cache.makeKey(msg.tenantId, RESOURCE_PRINT_JOB, p.jobId));
    } catch (err) {
      log.warn({ err, tenantId: msg.tenantId, jobId: p.jobId, event: "cache_invalidate_failed" },
        "print job cache invalidation failed after acknowledge");
    }
  });

  // ─── printJobFail ─────────────────────────────────────────────────────
  queue.subscribe<PrintJobFailPayload>(COMMANDS.printJobFail, async (msg) => {
    const p = msg.payload;
    const now = new Date();

    await db.transaction(async (tx): Promise<void> => {
      if (!(await markProcessed(tx, msg.messageId))) return;

      const rows = await tx
        .select()
        .from(printJobs)
        .where(and(eq(printJobs.id, p.jobId), eq(printJobs.tenantId, msg.tenantId)))
        .limit(1);
      const job = rows[0];
      if (!job) {
        throw new Error(`print job '${p.jobId}' not found for tenant '${msg.tenantId}'`);
      }

      if (shouldRetry(job.retryCount)) {
        // Can retry: increment retry count, compute next retry time, keep queued
        const nextRetryAt = computeNextRetryAt(job.retryCount, now);
        await versionedUpdate(tx, printJobs, {
          id: p.jobId,
          tenantId: msg.tenantId,
          expectedVersion: job.version,
          set: {
            retryCount: job.retryCount + 1,
            nextRetryAt,
            status: "queued",
            updatedAt: now,
          },
          entity: "print_job",
        });
      } else {
        // Max retries reached: mark as failed
        await versionedUpdate(tx, printJobs, {
          id: p.jobId,
          tenantId: msg.tenantId,
          expectedVersion: job.version,
          set: {
            status: "failed",
            updatedAt: now,
          },
          entity: "print_job",
        });

        // Alert facility ops via notification
        await enqueue(tx, {
          topic: NOTIFICATION_SEND,
          eventType: NOTIFICATION_SEND,
          tenantId: msg.tenantId,
          actorId: msg.actorId,
          correlationId: msg.correlationId,
          payload: buildNotificationPayload({
            channel: "push",
            eventType: EVENTS.printJobFailed,
            recipient: `tenant:${msg.tenantId}:facility_ops`,
            variables: {
              jobId: p.jobId,
              deviceId: p.deviceId,
              errorCode: p.errorCode ?? "unknown",
              errorMessage: p.errorMessage ?? "unknown",
              retryCount: String(job.retryCount + 1),
            },
          }),
        });
      }

      // Outbox: printJobFailed event
      await enqueue(tx, {
        topic: EVENTS.printJobFailed,
        eventType: EVENTS.printJobFailed,
        tenantId: msg.tenantId,
        actorId: msg.actorId,
        correlationId: msg.correlationId,
        payload: {
          id: p.jobId,
          tenantId: msg.tenantId,
          deviceId: p.deviceId,
          status: shouldRetry(job.retryCount) ? "queued" : "failed",
          retryCount: job.retryCount + 1,
          canRetry: shouldRetry(job.retryCount),
          errorCode: p.errorCode,
          errorMessage: p.errorMessage,
        },
      });
      await enqueue(tx, { topic: AUDIT_TOPIC, eventType: AUDIT_TOPIC, tenantId: msg.tenantId, actorId: msg.actorId, correlationId: msg.correlationId, payload: { service: "visitor-service", action: "fail", resourceType: "print_job", resourceId: p.jobId, outcome: "success" } });
    });

    // Invalidate cache
    try {
      await cache.invalidate(cache.makeKey(msg.tenantId, RESOURCE_PRINT_JOB, p.jobId));
    } catch (err) {
      log.warn({ err, tenantId: msg.tenantId, jobId: p.jobId, event: "cache_invalidate_failed" },
        "print job cache invalidation failed after fail");
    }
  });

  // ─── printJobRetry ────────────────────────────────────────────────────
  queue.subscribe<PrintJobRetryPayload>(COMMANDS.printJobRetry, async (msg) => {
    const p = msg.payload;
    const now = new Date();

    await db.transaction(async (tx): Promise<void> => {
      if (!(await markProcessed(tx, msg.messageId))) return;

      const rows = await tx
        .select()
        .from(printJobs)
        .where(and(eq(printJobs.id, p.jobId), eq(printJobs.tenantId, msg.tenantId)))
        .limit(1);
      const job = rows[0];
      if (!job) {
        throw new Error(`print job '${p.jobId}' not found for tenant '${msg.tenantId}'`);
      }

      // Re-enqueue with queued status
      const score = computeJobScore(job.priority as "standard" | "high", now);
      await versionedUpdate(tx, printJobs, {
        id: p.jobId,
        tenantId: msg.tenantId,
        expectedVersion: job.version,
        set: {
          status: "queued",
          nextRetryAt: null,
          updatedAt: now,
        },
        entity: "print_job",
      });

      await enqueue(tx, {
        topic: EVENTS.printJobCreated,
        eventType: EVENTS.printJobCreated,
        tenantId: msg.tenantId,
        actorId: msg.actorId,
        correlationId: msg.correlationId,
        payload: {
          id: p.jobId,
          tenantId: msg.tenantId,
          deviceId: p.deviceId,
          status: "queued",
          retried: true,
          score,
        },
      });
      await enqueue(tx, { topic: AUDIT_TOPIC, eventType: AUDIT_TOPIC, tenantId: msg.tenantId, actorId: msg.actorId, correlationId: msg.correlationId, payload: { service: "visitor-service", action: "create", resourceType: "print_job", resourceId: p.jobId, outcome: "success" } });
    });

    // Post-commit: ZADD to Redis sorted set (best-effort)
    try {
      const redis = getRedis();
      if (redis) {
        // Wrapped in db.transaction() so wrapWithTenantGuc injects app.tenant_id
        // before this read — a bare db.select() runs with no RLS GUC set.
        const rows = await db.transaction((tx) =>
          tx
            .select({ priority: printJobs.priority })
            .from(printJobs)
            .where(and(eq(printJobs.id, p.jobId), eq(printJobs.tenantId, msg.tenantId)))
            .limit(1),
        );
        const job = rows[0];
        if (job) {
          const score = computeJobScore(job.priority as "standard" | "high", new Date());
          await redis.zadd(printerJobsKey(msg.tenantId, p.deviceId), score, p.jobId);
        }
      }
    } catch (err) {
      log.warn({ err, tenantId: msg.tenantId, jobId: p.jobId, event: "redis_zadd_failed" },
        "print job Redis ZADD failed after retry");
    }

    try {
      await cache.invalidate(cache.makeKey(msg.tenantId, RESOURCE_PRINT_JOB, p.jobId));
    } catch (err) {
      log.warn({ err, tenantId: msg.tenantId, jobId: p.jobId, event: "cache_invalidate_failed" },
        "print job cache invalidation failed after retry");
    }
  });

  // ─── printJobRequeue ──────────────────────────────────────────────────
  queue.subscribe<PrintJobRequeuePayload>(COMMANDS.printJobRequeue, async (msg) => {
    const p = msg.payload;
    const now = new Date();

    await db.transaction(async (tx): Promise<void> => {
      if (!(await markProcessed(tx, msg.messageId))) return;

      const rows = await tx
        .select()
        .from(printJobs)
        .where(and(eq(printJobs.id, p.jobId), eq(printJobs.tenantId, msg.tenantId)))
        .limit(1);
      const job = rows[0];
      if (!job) {
        throw new Error(`print job '${p.jobId}' not found for tenant '${msg.tenantId}'`);
      }

      const oldDeviceId = job.deviceId;
      const score = computeJobScore(job.priority as "standard" | "high", now);

      // Update the job's device assignment and reset status to queued
      await versionedUpdate(tx, printJobs, {
        id: p.jobId,
        tenantId: msg.tenantId,
        expectedVersion: job.version,
        set: {
          deviceId: p.deviceId,
          status: "queued",
          nextRetryAt: null,
          updatedAt: now,
        },
        entity: "print_job",
      });

      await enqueue(tx, {
        topic: EVENTS.printJobCreated,
        eventType: EVENTS.printJobCreated,
        tenantId: msg.tenantId,
        actorId: msg.actorId,
        correlationId: msg.correlationId,
        payload: {
          id: p.jobId,
          tenantId: msg.tenantId,
          deviceId: p.deviceId,
          previousDeviceId: oldDeviceId,
          status: "queued",
          requeued: true,
          reason: p.reason,
          score,
        },
      });
      await enqueue(tx, { topic: AUDIT_TOPIC, eventType: AUDIT_TOPIC, tenantId: msg.tenantId, actorId: msg.actorId, correlationId: msg.correlationId, payload: { service: "visitor-service", action: "create", resourceType: "print_job", resourceId: p.jobId, outcome: "success" } });
    });

    // Post-commit: ZREM from old device, ZADD to new device (best-effort)
    try {
      const redis = getRedis();
      if (redis) {
        // Remove from old device's queue (we need the old device id)
        // Wrapped in db.transaction() so wrapWithTenantGuc injects app.tenant_id
        // before this read — a bare db.select() runs with no RLS GUC set.
        const rows = await db.transaction((tx) =>
          tx
            .select({ priority: printJobs.priority, deviceId: printJobs.deviceId })
            .from(printJobs)
            .where(and(eq(printJobs.id, p.jobId), eq(printJobs.tenantId, msg.tenantId)))
            .limit(1),
        );
        const job = rows[0];
        if (job) {
          // The job is already updated with new deviceId, so we ZADD to the new device
          const score = computeJobScore(job.priority as "standard" | "high", new Date());
          await redis.zadd(printerJobsKey(msg.tenantId, p.deviceId), score, p.jobId);
        }
      }
    } catch (err) {
      log.warn({ err, tenantId: msg.tenantId, jobId: p.jobId, event: "redis_requeue_failed" },
        "print job Redis requeue failed");
    }

    try {
      await cache.invalidate(cache.makeKey(msg.tenantId, RESOURCE_PRINT_JOB, p.jobId));
    } catch (err) {
      log.warn({ err, tenantId: msg.tenantId, jobId: p.jobId, event: "cache_invalidate_failed" },
        "print job cache invalidation failed after requeue");
    }
  });

  // ─── badgeTemplateCreate ──────────────────────────────────────────────
  queue.subscribe<BadgeTemplateCreatePayload>(COMMANDS.badgeTemplateCreate, async (msg) => {
    const p = msg.payload;

    await db.transaction(async (tx): Promise<void> => {
      if (!(await markProcessed(tx, msg.messageId))) return;

      // Validate placeholders in template body
      const validation = validateTemplatePlaceholders(p.templateBody);
      if (!validation.valid) {
        throw new Error(
          `badge template contains invalid placeholders: ${validation.invalidPlaceholders.join(", ")}`,
        );
      }

      // Insert badge template
      await tx.insert(badgeTemplates).values({
        id: p.id,
        tenantId: msg.tenantId,
        name: p.name,
        printerLanguage: p.printerLanguage,
        templateBody: p.templateBody,
        badgeWidthMm: p.badgeWidthMm,
        badgeHeightMm: p.badgeHeightMm,
        visitorCategory: p.visitorCategory,
        status: "active",
        templateVersion: 1,
        createdBy: msg.actorId,
        updatedBy: msg.actorId,
      });

      // Outbox: badgeTemplateCreated event
      await enqueue(tx, {
        topic: EVENTS.badgeTemplateCreated,
        eventType: EVENTS.badgeTemplateCreated,
        tenantId: msg.tenantId,
        actorId: msg.actorId,
        correlationId: msg.correlationId,
        payload: {
          id: p.id,
          tenantId: msg.tenantId,
          name: p.name,
          printerLanguage: p.printerLanguage,
          visitorCategory: p.visitorCategory,
          templateVersion: 1,
        },
      });
      await enqueue(tx, { topic: AUDIT_TOPIC, eventType: AUDIT_TOPIC, tenantId: msg.tenantId, actorId: msg.actorId, correlationId: msg.correlationId, payload: { service: "visitor-service", action: "create", resourceType: "badge_template", resourceId: p.id, outcome: "success" } });
    });

    // Post-commit: invalidate cache (best-effort)
    try {
      await cache.invalidate(cache.makeKey(msg.tenantId, RESOURCE_BADGE_TEMPLATE, p.id));
    } catch (err) {
      log.warn({ err, tenantId: msg.tenantId, templateId: p.id, event: "cache_invalidate_failed" },
        "badge template cache invalidation failed after create");
    }
  });

  // ─── badgeTemplateUpdate ──────────────────────────────────────────────
  queue.subscribe<BadgeTemplateUpdatePayload>(COMMANDS.badgeTemplateUpdate, async (msg) => {
    const p = msg.payload;

    await db.transaction(async (tx): Promise<void> => {
      if (!(await markProcessed(tx, msg.messageId))) return;

      // Load current template
      const rows = await tx
        .select()
        .from(badgeTemplates)
        .where(and(eq(badgeTemplates.id, p.templateId), eq(badgeTemplates.tenantId, msg.tenantId)))
        .limit(1);
      const current = rows[0];
      if (!current) {
        throw new Error(`badge template '${p.templateId}' not found for tenant '${msg.tenantId}'`);
      }

      // If template body is being updated, validate placeholders
      const newBody = p.templateBody ?? current.templateBody;
      if (p.templateBody) {
        const validation = validateTemplatePlaceholders(p.templateBody);
        if (!validation.valid) {
          throw new Error(
            `badge template contains invalid placeholders: ${validation.invalidPlaceholders.join(", ")}`,
          );
        }
      }

      // Create new version using domain logic
      const { templateVersion, previousVersionId } = createNewVersion({
        templateVersion: current.templateVersion,
        id: current.id,
      });

      // Insert new template row (new version)
      const newId = crypto.randomUUID();
      await tx.insert(badgeTemplates).values({
        id: newId,
        tenantId: msg.tenantId,
        name: p.name ?? current.name,
        printerLanguage: current.printerLanguage,
        templateBody: newBody,
        badgeWidthMm: p.badgeWidthMm ?? current.badgeWidthMm,
        badgeHeightMm: p.badgeHeightMm ?? current.badgeHeightMm,
        visitorCategory: p.visitorCategory ?? current.visitorCategory,
        status: "active",
        templateVersion,
        previousVersionId,
        createdBy: msg.actorId,
        updatedBy: msg.actorId,
      });

      // Archive the previous version
      await versionedUpdate(tx, badgeTemplates, {
        id: p.templateId,
        tenantId: msg.tenantId,
        expectedVersion: current.version,
        set: {
          status: "archived",
          updatedAt: new Date(),
          updatedBy: msg.actorId,
        },
        entity: "badge_template",
      });

      // Outbox: badgeTemplateUpdated event
      await enqueue(tx, {
        topic: EVENTS.badgeTemplateUpdated,
        eventType: EVENTS.badgeTemplateUpdated,
        tenantId: msg.tenantId,
        actorId: msg.actorId,
        correlationId: msg.correlationId,
        payload: {
          id: newId,
          previousVersionId,
          tenantId: msg.tenantId,
          name: p.name ?? current.name,
          printerLanguage: current.printerLanguage,
          visitorCategory: p.visitorCategory ?? current.visitorCategory,
          templateVersion,
        },
      });
      await enqueue(tx, { topic: AUDIT_TOPIC, eventType: AUDIT_TOPIC, tenantId: msg.tenantId, actorId: msg.actorId, correlationId: msg.correlationId, payload: { service: "visitor-service", action: "update", resourceType: "badge_template", resourceId: newId, outcome: "success" } });
    });

    // Post-commit: invalidate cache (best-effort)
    try {
      await cache.invalidate(cache.makeKey(msg.tenantId, RESOURCE_BADGE_TEMPLATE, p.templateId));
    } catch (err) {
      log.warn({ err, tenantId: msg.tenantId, templateId: p.templateId, event: "cache_invalidate_failed" },
        "badge template cache invalidation failed after update");
    }
  });
}
