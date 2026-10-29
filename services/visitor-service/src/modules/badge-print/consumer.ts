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
import { redisClientOptions } from "@civitasone/cache";
import type { Queue } from "@civitasone/queue";
import { NonRetryableError } from "@civitasone/queue";
import { NOTIFICATION_SEND, buildNotificationPayload } from "@civitasone/events";
import { db } from "../../shared/db.js";
import { enqueue, markProcessed, versionedUpdate } from "../../shared/outbox.js";
import { cache } from "../../shared/infra.js";
import { COMMANDS, EVENTS } from "../../topics.js";
import { badgeTemplates, printJobs } from "./schema.js";
import { digitalPasses } from "../digital-pass/schema.js";
import { visitRequests } from "../visit-request/schema.js";
import { renderBadge, validateTemplatePlaceholders } from "./renderer.js";
import { computeJobScore, shouldRetry, computeNextRetryAt } from "./domain.js";
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
  _redis = new Redis(url, redisClientOptions());
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
  /** UAT FQ9 #32: what to do with the template; absent ⇒ "update" (pre-fix messages). */
  op?: "update" | "rollback" | "archive";
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
      // Revoked/expired passes must never produce a printable badge — a
      // revoked pass has no scannable QR at the turnstile, but the physical
      // badge itself would otherwise still be rendered and handed out.
      // Non-retryable: retrying will never make a revoked pass printable.
      if (pass.revoked || pass.status === "revoked" || pass.status === "expired") {
        throw new NonRetryableError(
          `digital pass '${p.passId}' is ${pass.status}${pass.revoked ? " (revoked)" : ""} — refusing to print a badge for it`,
        );
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

  // ─── badgeTemplateUpdate (update | rollback | archive) ────────────────
  //
  // UAT FQ9 #32: an update used to INSERT a brand-new row (new id) and archive the one the client
  // named, so the template id the client holds stopped being the live template (GET showed the old
  // name, archived) and rollback on it 422'd NO_PREVIOUS_VERSION — the version chain hung off an id
  // the client never saw. Archive and rollback were also both modelled as a field-less "update",
  // which just cloned the row again (rollback even left two active versions).
  //
  // Now the template id is STABLE: the live row is versioned in place (templateVersion + 1) and the
  // content it replaces is kept as an archived snapshot row that the live row's previousVersionId
  // points at. Rollback restores the snapshot's content onto the live row and pops the chain;
  // archive archives the live row.
  queue.subscribe<BadgeTemplateUpdatePayload>(COMMANDS.badgeTemplateUpdate, async (msg) => {
    const p = msg.payload;
    const op = p.op ?? "update";

    await db.transaction(async (tx): Promise<void> => {
      if (!(await markProcessed(tx, msg.messageId))) return;

      // Load current (live) template
      const rows = await tx
        .select()
        .from(badgeTemplates)
        .where(and(eq(badgeTemplates.id, p.templateId), eq(badgeTemplates.tenantId, msg.tenantId)))
        .limit(1);
      const current = rows[0];
      if (!current) {
        throw new Error(`badge template '${p.templateId}' not found for tenant '${msg.tenantId}'`);
      }

      if (op === "archive") {
        await versionedUpdate(tx, badgeTemplates, {
          id: p.templateId,
          tenantId: msg.tenantId,
          expectedVersion: current.version,
          set: { status: "archived", updatedAt: new Date(), updatedBy: msg.actorId },
          entity: "badge_template",
        });
        await enqueue(tx, { topic: AUDIT_TOPIC, eventType: AUDIT_TOPIC, tenantId: msg.tenantId, actorId: msg.actorId, correlationId: msg.correlationId, payload: { service: "visitor-service", action: "archive", resourceType: "badge_template", resourceId: p.templateId, outcome: "success" } });
        return;
      }

      // The content the live row will carry after this command.
      let next: {
        name: string;
        templateBody: string;
        badgeWidthMm: number;
        badgeHeightMm: number;
        visitorCategory: string;
        previousVersionId: string | null;
      };

      if (op === "rollback") {
        if (!current.previousVersionId) {
          throw new NonRetryableError(`badge template '${p.templateId}' has no previous version to roll back to`);
        }
        const prevRows = await tx
          .select()
          .from(badgeTemplates)
          .where(and(eq(badgeTemplates.id, current.previousVersionId), eq(badgeTemplates.tenantId, msg.tenantId)))
          .limit(1);
        const prev = prevRows[0];
        if (!prev) {
          throw new NonRetryableError(`previous version '${current.previousVersionId}' of badge template '${p.templateId}' not found`);
        }
        next = {
          name: prev.name,
          templateBody: prev.templateBody,
          badgeWidthMm: prev.badgeWidthMm,
          badgeHeightMm: prev.badgeHeightMm,
          visitorCategory: prev.visitorCategory,
          previousVersionId: prev.previousVersionId, // pop the chain
        };
      } else {
        // If template body is being updated, validate placeholders
        if (p.templateBody) {
          const validation = validateTemplatePlaceholders(p.templateBody);
          if (!validation.valid) {
            throw new Error(
              `badge template contains invalid placeholders: ${validation.invalidPlaceholders.join(", ")}`,
            );
          }
        }
        next = {
          name: p.name ?? current.name,
          templateBody: p.templateBody ?? current.templateBody,
          badgeWidthMm: p.badgeWidthMm ?? current.badgeWidthMm,
          badgeHeightMm: p.badgeHeightMm ?? current.badgeHeightMm,
          visitorCategory: p.visitorCategory ?? current.visitorCategory,
          previousVersionId: null, // set to the snapshot below
        };
      }

      // Archived snapshot of the content being replaced (audit trail; the rollback target on update).
      const snapshotId = crypto.randomUUID();
      await tx.insert(badgeTemplates).values({
        id: snapshotId,
        tenantId: msg.tenantId,
        name: current.name,
        printerLanguage: current.printerLanguage,
        templateBody: current.templateBody,
        badgeWidthMm: current.badgeWidthMm,
        badgeHeightMm: current.badgeHeightMm,
        visitorCategory: current.visitorCategory,
        status: "archived",
        templateVersion: current.templateVersion,
        previousVersionId: current.previousVersionId,
        createdBy: msg.actorId,
        updatedBy: msg.actorId,
      });

      const templateVersion = current.templateVersion + 1;
      const previousVersionId = op === "update" ? snapshotId : next.previousVersionId;

      // Version the live row IN PLACE — its id never changes.
      await versionedUpdate(tx, badgeTemplates, {
        id: p.templateId,
        tenantId: msg.tenantId,
        expectedVersion: current.version,
        set: {
          name: next.name,
          templateBody: next.templateBody,
          badgeWidthMm: next.badgeWidthMm,
          badgeHeightMm: next.badgeHeightMm,
          visitorCategory: next.visitorCategory,
          templateVersion,
          previousVersionId,
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
          id: p.templateId,
          previousVersionId,
          tenantId: msg.tenantId,
          name: next.name,
          printerLanguage: current.printerLanguage,
          visitorCategory: next.visitorCategory,
          templateVersion,
          ...(op === "rollback" ? { rolledBack: true } : {}),
        },
      });
      await enqueue(tx, { topic: AUDIT_TOPIC, eventType: AUDIT_TOPIC, tenantId: msg.tenantId, actorId: msg.actorId, correlationId: msg.correlationId, payload: { service: "visitor-service", action: op === "rollback" ? "rollback" : "update", resourceType: "badge_template", resourceId: p.templateId, outcome: "success" } });
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
