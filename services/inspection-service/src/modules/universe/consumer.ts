/**
 * inspection-service: universe module — command consumers.
 *
 * Each handler follows the CivitasOne CQRS consumer contract:
 *   1. markProcessed(tx, msg.messageId) — idempotency guard
 *   2. Business write (insert/update) inside the same transaction
 *   3. Outbox: domain event + audit event (same transaction — atomicity)
 *   4. Cache invalidation (outside transaction — best-effort)
 *
 * entityUpdate uses optimistic locking: the UPDATE WHERE version = $current
 * returns 0 rows on conflict → 409 routed to DLQ (non-retryable).
 *
 * _Requirements: 1.4, 1.8, 2.1, 2.2_
 */
import { pino } from "pino";
import type { Queue } from "@civitasone/queue";
import { NonRetryableError } from "@civitasone/queue";
import { db } from "../../shared/db.js";
import { enqueue, markProcessed } from "../../shared/outbox.js";
import { cache } from "../../shared/infra.js";
import { COMMANDS, EVENTS } from "../../topics.js";
import {
  insertEntity,
  updateEntity,
  insertInspectionType,
  insertProvision,
  upsertVocabulary,
} from "./repo.js";
import type {
  EntityCreatePayload,
  EntityUpdatePayload,
  InspectionTypeCreatePayload,
  ProvisionCreatePayload,
  VocabularyUpsertPayload,
} from "./commands.js";

const log = pino({ name: "universe-consumer" });

const AUDIT_TOPIC = "audit.event.record";

// ── Registration ─────────────────────────────────────────────────────────────

export function registerUniverseConsumers(queue: Queue): void {
  // ─── entityCreate ────────────────────────────────────────────────────────
  queue.subscribe<EntityCreatePayload>(COMMANDS.entityCreate, async (msg) => {
    const p = msg.payload;
    let entityId: string | undefined;

    await db.transaction(async (tx) => {
      if (!(await markProcessed(tx, msg.messageId))) return;

      const entity = await insertEntity(tx, {
        tenantId: msg.tenantId,
        registrationNo: p.registrationNo,
        entityType: p.entityType,
        name: p.name,
        jurisdiction: p.jurisdiction,
        addressLine1: p.addressLine1,
        addressLine2: p.addressLine2 ?? null,
        city: p.city,
        state: p.state,
        pincode: p.pincode,
        latitude: p.latitude ?? null,
        longitude: p.longitude ?? null,
        riskCategory: p.riskCategory,
        metadata: p.metadata ?? null,
        createdBy: msg.actorId,
        updatedBy: msg.actorId,
      });

      entityId = entity.id;

      // Domain event via outbox
      await enqueue(tx, {
        topic: EVENTS.entityCreated,
        eventType: EVENTS.entityCreated,
        tenantId: msg.tenantId,
        actorId: msg.actorId,
        correlationId: msg.correlationId,
        payload: {
          entityId: entity.id,
          registrationNo: entity.registrationNo,
          entityType: entity.entityType,
          name: entity.name,
          jurisdiction: entity.jurisdiction,
          riskCategory: entity.riskCategory,
        },
      });

      // Audit event
      await enqueue(tx, {
        topic: AUDIT_TOPIC,
        eventType: AUDIT_TOPIC,
        tenantId: msg.tenantId,
        actorId: msg.actorId,
        correlationId: msg.correlationId,
        payload: {
          action: "entity.created",
          resourceType: "regulated_entity",
          resourceId: entity.id,
          details: { registrationNo: entity.registrationNo, entityType: entity.entityType },
        },
      });
    });

    // Cache invalidation (outside transaction, best-effort)
    if (entityId) {
      try {
        await cache.invalidate(cache.makeKey(msg.tenantId, "entity", entityId));
      } catch (err) {
        log.warn({ err, tenantId: msg.tenantId, entityId, event: "cache_invalidate_failed" },
          "failed to invalidate entity cache after create");
      }
    }
  });

  // ─── entityUpdate ────────────────────────────────────────────────────────
  queue.subscribe<EntityUpdatePayload>(COMMANDS.entityUpdate, async (msg) => {
    const p = msg.payload;
    let updatedEntityId: string | undefined;

    await db.transaction(async (tx) => {
      if (!(await markProcessed(tx, msg.messageId))) return;

      // Optimistic locking: updateEntity throws 409 HttpError if version mismatch
      let entity;
      try {
        entity = await updateEntity(tx, p.entityId, p.version, p.patch);
      } catch (err: unknown) {
        if (err instanceof Error && "status" in err && (err as unknown as { status: number }).status === 409) {
          throw new NonRetryableError(err.message);
        }
        throw err;
      }

      updatedEntityId = entity.id;
      const changedFields = Object.keys(p.patch);

      // Domain event via outbox
      await enqueue(tx, {
        topic: EVENTS.entityUpdated,
        eventType: EVENTS.entityUpdated,
        tenantId: msg.tenantId,
        actorId: msg.actorId,
        correlationId: msg.correlationId,
        payload: {
          entityId: entity.id,
          version: entity.version,
          changedFields,
        },
      });

      // Audit event
      await enqueue(tx, {
        topic: AUDIT_TOPIC,
        eventType: AUDIT_TOPIC,
        tenantId: msg.tenantId,
        actorId: msg.actorId,
        correlationId: msg.correlationId,
        payload: {
          action: "entity.updated",
          resourceType: "regulated_entity",
          resourceId: entity.id,
          details: { version: entity.version, changedFields, patch: p.patch },
        },
      });
    });

    // Cache invalidation (outside transaction, best-effort)
    if (updatedEntityId) {
      try {
        await cache.invalidate(cache.makeKey(msg.tenantId, "entity", updatedEntityId));
      } catch (err) {
        log.warn({ err, tenantId: msg.tenantId, entityId: updatedEntityId, event: "cache_invalidate_failed" },
          "failed to invalidate entity cache after update");
      }
    }
  });

  // ─── inspectionTypeCreate ────────────────────────────────────────────────
  queue.subscribe<InspectionTypeCreatePayload>(COMMANDS.inspectionTypeCreate, async (msg) => {
    const p = msg.payload;
    let typeId: string | undefined;

    await db.transaction(async (tx) => {
      if (!(await markProcessed(tx, msg.messageId))) return;

      const inspType = await insertInspectionType(tx, {
        tenantId: msg.tenantId,
        code: p.code,
        name: p.name,
        applicableEntityTypes: p.applicableEntityTypes,
        requiredCompetencies: p.requiredCompetencies,
        defaultTemplateIds: p.defaultTemplateIds ?? [],
        regulatoryBasis: p.regulatoryBasis ?? null,
        createdBy: msg.actorId,
        updatedBy: msg.actorId,
      });

      typeId = inspType.id;

      // Audit event
      await enqueue(tx, {
        topic: AUDIT_TOPIC,
        eventType: AUDIT_TOPIC,
        tenantId: msg.tenantId,
        actorId: msg.actorId,
        correlationId: msg.correlationId,
        payload: {
          action: "inspection_type.created",
          resourceType: "inspection_type",
          resourceId: inspType.id,
          details: { code: inspType.code, name: inspType.name },
        },
      });
    });

    // Cache invalidation (outside transaction, best-effort)
    if (typeId) {
      try {
        await cache.invalidate(cache.makeKey(msg.tenantId, "inspection_type", typeId));
      } catch (err) {
        log.warn({ err, tenantId: msg.tenantId, typeId, event: "cache_invalidate_failed" },
          "failed to invalidate inspection_type cache after create");
      }
    }
  });

  // ─── provisionCreate ─────────────────────────────────────────────────────
  queue.subscribe<ProvisionCreatePayload>(COMMANDS.provisionCreate, async (msg) => {
    const p = msg.payload;
    let provisionId: string | undefined;

    await db.transaction(async (tx) => {
      if (!(await markProcessed(tx, msg.messageId))) return;

      const provision = await insertProvision(tx, {
        tenantId: msg.tenantId,
        actReference: p.actReference,
        sectionNumber: p.sectionNumber,
        description: p.description,
        penaltyClause: p.penaltyClause ?? null,
        severityClass: p.severityClassification,
        createdBy: msg.actorId,
        updatedBy: msg.actorId,
      });

      provisionId = provision.id;

      // Audit event
      await enqueue(tx, {
        topic: AUDIT_TOPIC,
        eventType: AUDIT_TOPIC,
        tenantId: msg.tenantId,
        actorId: msg.actorId,
        correlationId: msg.correlationId,
        payload: {
          action: "provision.created",
          resourceType: "provision",
          resourceId: provision.id,
          details: { actReference: provision.actReference, sectionNumber: provision.sectionNumber },
        },
      });
    });

    // Cache invalidation (outside transaction, best-effort)
    if (provisionId) {
      try {
        await cache.invalidate(cache.makeKey(msg.tenantId, "provision", provisionId));
      } catch (err) {
        log.warn({ err, tenantId: msg.tenantId, provisionId, event: "cache_invalidate_failed" },
          "failed to invalidate provision cache after create");
      }
    }
  });

  // ─── vocabularyUpsert ────────────────────────────────────────────────────
  queue.subscribe<VocabularyUpsertPayload>(COMMANDS.vocabularyUpsert, async (msg) => {
    const p = msg.payload;
    let vocabId: string | undefined;

    await db.transaction(async (tx) => {
      if (!(await markProcessed(tx, msg.messageId))) return;

      const vocab = await upsertVocabulary(tx, {
        tenantId: msg.tenantId,
        category: p.category,
        code: p.code,
        label: p.label,
        sortOrder: p.sortOrder ?? 0,
        createdBy: msg.actorId,
        updatedBy: msg.actorId,
      });

      vocabId = vocab.id;

      // Audit event
      await enqueue(tx, {
        topic: AUDIT_TOPIC,
        eventType: AUDIT_TOPIC,
        tenantId: msg.tenantId,
        actorId: msg.actorId,
        correlationId: msg.correlationId,
        payload: {
          action: "vocabulary.upserted",
          resourceType: "vocabulary",
          resourceId: vocab.id,
          details: { category: vocab.category, code: vocab.code, label: vocab.label },
        },
      });
    });

    // Cache invalidation (outside transaction, best-effort)
    if (vocabId) {
      try {
        await cache.invalidate(cache.makeKey(msg.tenantId, "vocabulary", vocabId));
      } catch (err) {
        log.warn({ err, tenantId: msg.tenantId, vocabId, event: "cache_invalidate_failed" },
          "failed to invalidate vocabulary cache after upsert");
      }
    }
  });
}
