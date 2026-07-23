/**
 * inspection-service: Licence module — command consumers.
 *
 * _Requirements: SVC-108_
 */
import { pino } from "pino";
import type { Queue } from "@civitasone/queue";
import { NonRetryableError } from "@civitasone/queue";
import { db } from "../../shared/db.js";
import { enqueue, markProcessed } from "../../shared/outbox.js";
import { cache } from "../../shared/infra.js";
import { COMMANDS, EVENTS } from "../../topics.js";
import {
  assertValidLicenceTransition,
  assertRenewalAllowed,
  DomainError,
  type LicenceState,
} from "./domain.js";
import { insertLicence, updateLicence, findLicenceById } from "./repo.js";
import type {
  LicenceCreatePayload,
  LicenceUpdatePayload,
  LicenceRenewPayload,
  LicenceSuspendPayload,
  LicenceRevokePayload,
} from "./commands.js";

const log = pino({ name: "licence-consumer" });

const AUDIT_TOPIC = "audit.event.record";

export function registerLicenceConsumers(queue: Queue): void {
  // ─── licenceCreate ────────────────────────────────────────────────────────
  queue.subscribe<LicenceCreatePayload & { tenantId: string }>(
    COMMANDS.licenceCreate,
    async (msg) => {
      const p = msg.payload;
      let licenceId: string | undefined;

      await db.transaction(async (tx) => {
        if (!(await markProcessed(tx, msg.messageId))) return;

        const licence = await insertLicence(tx, {
          tenantId: msg.tenantId,
          entityId: p.entityId,
          licenceType: p.licenceType,
          licenceNumber: p.licenceNumber,
          validFrom: p.validFrom,
          validTo: p.validTo,
          conditions: p.conditions ?? null,
          renewalFee: p.renewalFee ? BigInt(p.renewalFee) : null,
          currency: p.currency ?? "INR",
          status: "active",
          createdBy: msg.actorId,
          updatedBy: msg.actorId,
        });

        licenceId = licence.id;

        await enqueue(tx, {
          topic: EVENTS.licenceRegistered,
          eventType: EVENTS.licenceRegistered,
          tenantId: msg.tenantId,
          actorId: msg.actorId,
          correlationId: msg.correlationId,
          payload: {
            licenceId: licence.id,
            entityId: p.entityId,
            licenceType: p.licenceType,
            licenceNumber: p.licenceNumber,
          },
        });

        await enqueue(tx, {
          topic: AUDIT_TOPIC,
          eventType: AUDIT_TOPIC,
          tenantId: msg.tenantId,
          actorId: msg.actorId,
          correlationId: msg.correlationId,
          payload: {
            action: "licence.registered",
            resourceType: "licence",
            resourceId: licence.id,
            details: { entityId: p.entityId, licenceType: p.licenceType },
          },
        });
      });

      if (licenceId) {
        try { await cache.invalidate(cache.makeKey(msg.tenantId, "licence", licenceId)); }
        catch (err) { log.warn({ err, event: "cache_invalidate_failed" }, "cache invalidation failed"); }
      }
    },
  );

  // ─── licenceUpdate ────────────────────────────────────────────────────────
  queue.subscribe<LicenceUpdatePayload & { tenantId: string }>(
    COMMANDS.licenceUpdate,
    async (msg) => {
      const p = msg.payload;

      await db.transaction(async (tx) => {
        if (!(await markProcessed(tx, msg.messageId))) return;

        const patch: Record<string, unknown> = { updatedBy: msg.actorId };
        if (p.licenceType !== undefined) patch.licenceType = p.licenceType;
        if (p.licenceNumber !== undefined) patch.licenceNumber = p.licenceNumber;
        if (p.validFrom !== undefined) patch.validFrom = p.validFrom;
        if (p.validTo !== undefined) patch.validTo = p.validTo;
        if (p.conditions !== undefined) patch.conditions = p.conditions;
        if (p.renewalFee !== undefined) patch.renewalFee = BigInt(p.renewalFee);

        await updateLicence(tx, p.licenceId, msg.tenantId, patch, p.version);

        await enqueue(tx, {
          topic: AUDIT_TOPIC,
          eventType: AUDIT_TOPIC,
          tenantId: msg.tenantId,
          actorId: msg.actorId,
          correlationId: msg.correlationId,
          payload: {
            action: "licence.updated",
            resourceType: "licence",
            resourceId: p.licenceId,
            details: { changedFields: Object.keys(patch) },
          },
        });
      });

      try { await cache.invalidate(cache.makeKey(msg.tenantId, "licence", p.licenceId)); }
      catch (err) { log.warn({ err, event: "cache_invalidate_failed" }, "cache invalidation failed"); }
    },
  );

  // ─── licenceRenew ─────────────────────────────────────────────────────────
  queue.subscribe<LicenceRenewPayload & { tenantId: string }>(
    COMMANDS.licenceRenew,
    async (msg) => {
      const p = msg.payload;

      await db.transaction(async (tx) => {
        if (!(await markProcessed(tx, msg.messageId))) return;

        const licence = await findLicenceById(msg.tenantId, p.licenceId);
        if (!licence) {
          throw new NonRetryableError(`Licence not found: ${p.licenceId}`);
        }

        try {
          assertRenewalAllowed(licence.status as LicenceState);
        } catch (err) {
          if (err instanceof DomainError) throw new NonRetryableError(err.message);
          throw err;
        }

        // Transition to pending_renewal first
        try {
          assertValidLicenceTransition(licence.status as LicenceState, "pending_renewal");
        } catch (err) {
          if (err instanceof DomainError) throw new NonRetryableError(err.message);
          throw err;
        }

        await updateLicence(tx, p.licenceId, msg.tenantId, {
          status: "pending_renewal",
          lastRenewalAt: new Date(),
          updatedBy: msg.actorId,
        }, licence.version);

        await enqueue(tx, {
          topic: EVENTS.licenceRenewalInitiated,
          eventType: EVENTS.licenceRenewalInitiated,
          tenantId: msg.tenantId,
          actorId: msg.actorId,
          correlationId: msg.correlationId,
          payload: { licenceId: p.licenceId, entityId: licence.entityId },
        });

        await enqueue(tx, {
          topic: AUDIT_TOPIC,
          eventType: AUDIT_TOPIC,
          tenantId: msg.tenantId,
          actorId: msg.actorId,
          correlationId: msg.correlationId,
          payload: {
            action: "licence.renewal_initiated",
            resourceType: "licence",
            resourceId: p.licenceId,
            details: { previousStatus: licence.status },
          },
        });
      });

      try { await cache.invalidate(cache.makeKey(msg.tenantId, "licence", p.licenceId)); }
      catch (err) { log.warn({ err, event: "cache_invalidate_failed" }, "cache invalidation failed"); }
    },
  );

  // ─── licenceSuspend ───────────────────────────────────────────────────────
  queue.subscribe<LicenceSuspendPayload & { tenantId: string }>(
    COMMANDS.licenceSuspend,
    async (msg) => {
      const p = msg.payload;

      await db.transaction(async (tx) => {
        if (!(await markProcessed(tx, msg.messageId))) return;

        const licence = await findLicenceById(msg.tenantId, p.licenceId);
        if (!licence) {
          throw new NonRetryableError(`Licence not found: ${p.licenceId}`);
        }

        try {
          assertValidLicenceTransition(licence.status as LicenceState, "suspended");
        } catch (err) {
          if (err instanceof DomainError) throw new NonRetryableError(err.message);
          throw err;
        }

        await updateLicence(tx, p.licenceId, msg.tenantId, {
          status: "suspended",
          updatedBy: msg.actorId,
        }, licence.version);

        await enqueue(tx, {
          topic: EVENTS.licenceSuspended,
          eventType: EVENTS.licenceSuspended,
          tenantId: msg.tenantId,
          actorId: msg.actorId,
          correlationId: msg.correlationId,
          payload: { licenceId: p.licenceId, entityId: licence.entityId },
        });

        await enqueue(tx, {
          topic: AUDIT_TOPIC,
          eventType: AUDIT_TOPIC,
          tenantId: msg.tenantId,
          actorId: msg.actorId,
          correlationId: msg.correlationId,
          payload: {
            action: "licence.suspended",
            resourceType: "licence",
            resourceId: p.licenceId,
            details: {},
          },
        });
      });

      try { await cache.invalidate(cache.makeKey(msg.tenantId, "licence", p.licenceId)); }
      catch (err) { log.warn({ err, event: "cache_invalidate_failed" }, "cache invalidation failed"); }
    },
  );

  // ─── licenceRevoke ────────────────────────────────────────────────────────
  queue.subscribe<LicenceRevokePayload & { tenantId: string }>(
    COMMANDS.licenceRevoke,
    async (msg) => {
      const p = msg.payload;

      await db.transaction(async (tx) => {
        if (!(await markProcessed(tx, msg.messageId))) return;

        const licence = await findLicenceById(msg.tenantId, p.licenceId);
        if (!licence) {
          throw new NonRetryableError(`Licence not found: ${p.licenceId}`);
        }

        try {
          assertValidLicenceTransition(licence.status as LicenceState, "revoked");
        } catch (err) {
          if (err instanceof DomainError) throw new NonRetryableError(err.message);
          throw err;
        }

        await updateLicence(tx, p.licenceId, msg.tenantId, {
          status: "revoked",
          updatedBy: msg.actorId,
        }, licence.version);

        await enqueue(tx, {
          topic: EVENTS.licenceRevoked,
          eventType: EVENTS.licenceRevoked,
          tenantId: msg.tenantId,
          actorId: msg.actorId,
          correlationId: msg.correlationId,
          payload: { licenceId: p.licenceId, entityId: licence.entityId },
        });

        await enqueue(tx, {
          topic: AUDIT_TOPIC,
          eventType: AUDIT_TOPIC,
          tenantId: msg.tenantId,
          actorId: msg.actorId,
          correlationId: msg.correlationId,
          payload: {
            action: "licence.revoked",
            resourceType: "licence",
            resourceId: p.licenceId,
            details: {},
          },
        });
      });

      try { await cache.invalidate(cache.makeKey(msg.tenantId, "licence", p.licenceId)); }
      catch (err) { log.warn({ err, event: "cache_invalidate_failed" }, "cache invalidation failed"); }
    },
  );
}
