/**
 * visitor-service: recurring-pass consumer.
 *
 * Handles `COMMANDS.recurringPassCreate` / `COMMANDS.recurringPassSuspend` /
 * `COMMANDS.recurringPassRevoke`:
 *
 * recurringPassCreate:
 *   markProcessed(tx, msg.messageId) → validate validity window (domain) →
 *   insert `recurring_passes` row → outbox `NOTIFICATION_SEND` to pass
 *   holder (Requirement 12.1).
 *
 * recurringPassSuspend:
 *   markProcessed(tx, msg.messageId) → domain.suspend state transition →
 *   update row (status = "suspended", suspendedAt, suspendReason) → outbox
 *   `NOTIFICATION_SEND` to pass holder + issuing manager (Requirement 12.5).
 *   After commit: add pass ID to Redis revocation set (effective within 30s
 *   at all gate terminals, Requirement 12.4).
 *
 * recurringPassRevoke:
 *   markProcessed(tx, msg.messageId) → domain.revoke state transition →
 *   update row (status = "revoked") → outbox `NOTIFICATION_SEND` to pass
 *   holder + issuing manager (Requirement 12.5). After commit: add pass ID
 *   to Redis revocation set (Requirement 12.4).
 *
 * Follows the CQRS consumer pattern from modules/blacklist/consumer.ts.
 *
 * Graceful degradation: Redis revocation-set sync happens AFTER the DB
 * transaction commits. A sync failure is caught, logged at WARN (not ERROR),
 * and does NOT fail the message — the pass status has already been durably
 * recorded in Postgres, and the revocation set is a best-effort mirror that
 * self-heals on the next suspend/revoke or gate-sync refresh.
 */
import { pino } from "pino";
import { and, eq } from "drizzle-orm";
import type { Queue } from "@civitasone/queue";
import { NOTIFICATION_SEND, buildNotificationPayload } from "@civitasone/events";
import { db } from "../../shared/db.js";
import { enqueue, markProcessed, versionedUpdate } from "../../shared/outbox.js";
import { COMMANDS } from "../../topics.js";
import { recurringPasses } from "./schema.js";
import { validateValidityWindow, suspend, revoke, type RecurringPassStatus } from "./domain.js";
import { addToRevocationSet } from "./revocation-store.js";

const AUDIT_TOPIC = "audit.event.record";

const log = pino({ name: "recurring-pass-consumer" });

// ── Payload Types ────────────────────────────────────────────────────────

export interface RecurringPassCreatePayload {
  id: string;
  passId: string;
  tenantId: string;
  locationId: string;
  visitorName: string;
  visitorPhone: string;
  companyName: string | null;
  validFrom: string;
  validUntil: string;
  permittedDays: number[];
  permittedTimeFrom: string | null;
  permittedTimeTo: string | null;
}

export interface RecurringPassSuspendPayload {
  id: string;
  tenantId: string;
  reason: string;
}

export interface RecurringPassRevokePayload {
  id: string;
  tenantId: string;
  reason: string | null;
}

// ── Consumer Registration ────────────────────────────────────────────────

export function registerRecurringPassConsumers(queue: Queue): void {
  // ─── recurringPassCreate ─────────────────────────────────────────────
  queue.subscribe<RecurringPassCreatePayload>(COMMANDS.recurringPassCreate, async (msg) => {
    const p = msg.payload;

    // Validate domain rules (throws DomainError on invalid window)
    const validFrom = new Date(p.validFrom);
    const validUntil = new Date(p.validUntil);
    validateValidityWindow(validFrom, validUntil);

    await db.transaction(async (tx): Promise<void> => {
      if (!(await markProcessed(tx, msg.messageId))) return; // idempotent replay

      await tx.insert(recurringPasses).values({
        id: p.id,
        tenantId: msg.tenantId,
        locationId: p.locationId,
        passId: p.passId,
        visitorName: p.visitorName,
        visitorPhone: p.visitorPhone,
        companyName: p.companyName,
        validFrom,
        validUntil,
        permittedDays: p.permittedDays,
        permittedTimeFrom: p.permittedTimeFrom,
        permittedTimeTo: p.permittedTimeTo,
        status: "active",
        issuedBy: msg.actorId,
        createdBy: msg.actorId,
        updatedBy: msg.actorId,
      });

      // Notify pass holder of new recurring pass
      await enqueue(tx, {
        topic: NOTIFICATION_SEND,
        eventType: "visitor.recurring_pass.created",
        tenantId: msg.tenantId,
        actorId: msg.actorId,
        correlationId: msg.correlationId,
        payload: buildNotificationPayload({
          eventType: "visitor.recurring_pass.created",
          recipient: p.visitorPhone,
          channel: "sms",
          variables: {
            visitorName: p.visitorName,
            validFrom: p.validFrom,
            validUntil: p.validUntil,
          },
        }),
      });
      await enqueue(tx, { topic: AUDIT_TOPIC, eventType: AUDIT_TOPIC, tenantId: msg.tenantId, actorId: msg.actorId, correlationId: msg.correlationId, payload: { service: "visitor-service", action: "process", resourceType: "recurring_pass", resourceId: p.id, outcome: "success" } });
    });
  });

  // ─── recurringPassSuspend ────────────────────────────────────────────
  queue.subscribe<RecurringPassSuspendPayload>(COMMANDS.recurringPassSuspend, async (msg) => {
    const p = msg.payload;

    const suspended = await db.transaction(async (tx): Promise<{ passId: string; visitorPhone: string; issuedBy: string } | null> => {
      if (!(await markProcessed(tx, msg.messageId))) return null; // idempotent replay

      const rows = await tx
        .select()
        .from(recurringPasses)
        .where(and(eq(recurringPasses.id, p.id), eq(recurringPasses.tenantId, msg.tenantId)))
        .limit(1);
      const entry = rows[0];
      if (!entry) {
        throw new Error(`recurring pass '${p.id}' not found for tenant '${msg.tenantId}'`);
      }

      // Domain state transition — throws DomainError if invalid
      suspend(entry.status as RecurringPassStatus);

      await versionedUpdate(tx, recurringPasses, {
        id: p.id,
        tenantId: msg.tenantId,
        expectedVersion: entry.version,
        set: {
          status: "suspended",
          suspendedAt: new Date(),
          suspendReason: p.reason,
          updatedAt: new Date(),
          updatedBy: msg.actorId,
        },
        entity: "recurring_pass",
      });

      // Notify pass holder (Requirement 12.5)
      await enqueue(tx, {
        topic: NOTIFICATION_SEND,
        eventType: "visitor.recurring_pass.suspended",
        tenantId: msg.tenantId,
        actorId: msg.actorId,
        correlationId: msg.correlationId,
        payload: buildNotificationPayload({
          eventType: "visitor.recurring_pass.suspended",
          recipient: entry.visitorPhone,
          channel: "sms",
          variables: { visitorName: entry.visitorName, reason: p.reason },
        }),
      });

      // Notify issuing manager (Requirement 12.5)
      await enqueue(tx, {
        topic: NOTIFICATION_SEND,
        eventType: "visitor.recurring_pass.suspended",
        tenantId: msg.tenantId,
        actorId: msg.actorId,
        correlationId: msg.correlationId,
        payload: buildNotificationPayload({
          eventType: "visitor.recurring_pass.suspended",
          recipientId: entry.issuedBy,
          recipient: entry.issuedBy, // resolved by notification-service via recipientId
          channel: "push",
          variables: { visitorName: entry.visitorName, reason: p.reason },
        }),
      });
      await enqueue(tx, { topic: AUDIT_TOPIC, eventType: AUDIT_TOPIC, tenantId: msg.tenantId, actorId: msg.actorId, correlationId: msg.correlationId, payload: { service: "visitor-service", action: "process", resourceType: "recurring_pass", resourceId: p.id, outcome: "success" } });

      return { passId: entry.passId, visitorPhone: entry.visitorPhone, issuedBy: entry.issuedBy };
    });

    if (!suspended) return; // already processed (idempotent replay)

    // Requirement 12.4 — add to Redis revocation set so gate terminals
    // reject this pass within 30s. Best-effort: never fail an already-
    // committed suspend because Redis is unavailable.
    try {
      await addToRevocationSet(msg.tenantId, suspended.passId);
    } catch (err) {
      log.warn(
        { err, tenantId: msg.tenantId, passId: p.id, event: "recurring_pass_revocation_sync_failed" },
        "recurring pass revocation-set sync failed on suspend; pass already suspended in DB, set will self-heal",
      );
    }
  });

  // ─── recurringPassRevoke ─────────────────────────────────────────────
  queue.subscribe<RecurringPassRevokePayload>(COMMANDS.recurringPassRevoke, async (msg) => {
    const p = msg.payload;

    const revoked = await db.transaction(async (tx): Promise<{ passId: string; visitorPhone: string; issuedBy: string } | null> => {
      if (!(await markProcessed(tx, msg.messageId))) return null; // idempotent replay

      const rows = await tx
        .select()
        .from(recurringPasses)
        .where(and(eq(recurringPasses.id, p.id), eq(recurringPasses.tenantId, msg.tenantId)))
        .limit(1);
      const entry = rows[0];
      if (!entry) {
        throw new Error(`recurring pass '${p.id}' not found for tenant '${msg.tenantId}'`);
      }

      // Domain state transition — throws DomainError if invalid
      revoke(entry.status as RecurringPassStatus);

      await versionedUpdate(tx, recurringPasses, {
        id: p.id,
        tenantId: msg.tenantId,
        expectedVersion: entry.version,
        set: {
          status: "revoked",
          updatedAt: new Date(),
          updatedBy: msg.actorId,
        },
        entity: "recurring_pass",
      });

      // Notify pass holder (Requirement 12.5)
      await enqueue(tx, {
        topic: NOTIFICATION_SEND,
        eventType: "visitor.recurring_pass.revoked",
        tenantId: msg.tenantId,
        actorId: msg.actorId,
        correlationId: msg.correlationId,
        payload: buildNotificationPayload({
          eventType: "visitor.recurring_pass.revoked",
          recipient: entry.visitorPhone,
          channel: "sms",
          variables: { visitorName: entry.visitorName, reason: p.reason ?? "Pass revoked" },
        }),
      });

      // Notify issuing manager (Requirement 12.5)
      await enqueue(tx, {
        topic: NOTIFICATION_SEND,
        eventType: "visitor.recurring_pass.revoked",
        tenantId: msg.tenantId,
        actorId: msg.actorId,
        correlationId: msg.correlationId,
        payload: buildNotificationPayload({
          eventType: "visitor.recurring_pass.revoked",
          recipientId: entry.issuedBy,
          recipient: entry.issuedBy, // resolved by notification-service via recipientId
          channel: "push",
          variables: { visitorName: entry.visitorName, reason: p.reason ?? "Pass revoked" },
        }),
      });
      await enqueue(tx, { topic: AUDIT_TOPIC, eventType: AUDIT_TOPIC, tenantId: msg.tenantId, actorId: msg.actorId, correlationId: msg.correlationId, payload: { service: "visitor-service", action: "process", resourceType: "recurring_pass", resourceId: p.id, outcome: "success" } });

      return { passId: entry.passId, visitorPhone: entry.visitorPhone, issuedBy: entry.issuedBy };
    });

    if (!revoked) return; // already processed (idempotent replay)

    // Requirement 12.4 — add to Redis revocation set so gate terminals
    // reject this pass within 30s. Best-effort: never fail an already-
    // committed revoke because Redis is unavailable.
    try {
      await addToRevocationSet(msg.tenantId, revoked.passId);
    } catch (err) {
      log.warn(
        { err, tenantId: msg.tenantId, passId: p.id, event: "recurring_pass_revocation_sync_failed" },
        "recurring pass revocation-set sync failed on revoke; pass already revoked in DB, set will self-heal",
      );
    }
  });
}
