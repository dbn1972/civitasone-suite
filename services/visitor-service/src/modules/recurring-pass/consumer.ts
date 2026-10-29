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
import { randomUUID } from "node:crypto";
import { pino } from "pino";
import { and, eq } from "drizzle-orm";
import { NonRetryableError, type Queue } from "@civitasone/queue";
import { NOTIFICATION_SEND, buildNotificationPayload } from "@civitasone/events";
import { db } from "../../shared/db.js";
import { enqueue, markProcessed, versionedUpdate } from "../../shared/outbox.js";
import { COMMANDS } from "../../topics.js";
import { recurringPasses } from "./schema.js";
import { visitRequests } from "../visit-request/schema.js";
import { digitalPasses } from "../digital-pass/schema.js";
import { generatePass } from "../digital-pass/domain.js";
import { validateValidityWindow, suspend, revoke, type RecurringPassStatus } from "./domain.js";
import { addToRevocationSet } from "./revocation-store.js";
// BUG FIX: gate verification (check-in/routes.ts) checks ONLY
// digital-pass/revocation-store.ts's set, never this module's own
// `visitor:{tid}:recurring_pass:revoked` set — so a suspended/revoked
// recurring pass previously never actually blocked at the gate. Dual-write
// into the canonical digital-pass store too (keyed by the same
// `entry.passId` / `revoked.passId` — the underlying digital_passes.id —
// already used for this module's own set below) so there is one real
// source of truth check-in's verification can rely on.
import { addToRevokedSet as addToDigitalPassRevokedSet } from "../digital-pass/revocation-store.js";

const AUDIT_TOPIC = "audit.event.record";

const log = pino({ name: "recurring-pass-consumer" });

/** Postgres foreign_key_violation. */
const PG_FOREIGN_KEY_VIOLATION = "23503";

function isForeignKeyViolation(err: unknown): boolean {
  for (let e: unknown = err, i = 0; e && i < 5; e = (e as { cause?: unknown }).cause, i++) {
    if ((e as { code?: unknown }).code === PG_FOREIGN_KEY_VIOLATION) return true;
  }
  return false;
}

/**
 * Service-level pass-QR signing key — the same source visit-request/consumer.ts uses for every other
 * digital pass (VISITOR_TENANT_SIGNING_KEY_PEM). A missing key can never succeed on retry.
 */
function passSigningKeyPem(): string {
  const pem = process.env.VISITOR_TENANT_SIGNING_KEY_PEM;
  if (!pem) {
    throw new NonRetryableError("VISITOR_TENANT_SIGNING_KEY_PEM is not configured — cannot sign the recurring pass QR");
  }
  return pem;
}

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
    const signingKey = passSigningKeyPem();

    await db.transaction(async (tx): Promise<void> => {
      if (!(await markProcessed(tx, msg.messageId))) return; // idempotent replay

      // UAT FQ9 #28: recurring_passes.pass_id is NOT NULL REFERENCES digital_passes(id), but this
      // handler inserted a freshly minted passId that no digital pass carried, so EVERY create died on
      // recurring_passes_pass_id_fkey and dead-lettered after the 202. The pass holder's gate QR is a
      // real digital pass (gate verification, revocation and gate-sync are all keyed on
      // digital_passes.id = recurring_passes.pass_id), and a digital pass hangs off a visit request.
      // Issue both here, in the same transaction, the way group-visit/consumer.ts does for members:
      // a pre-approved `recurring` visit request hosted by the issuing manager, then the digital pass
      // with the pre-minted passId, then the recurring_passes row that references it.
      const visitRequestId = randomUUID();
      try {
        await tx.insert(visitRequests).values({
          id: visitRequestId,
          tenantId: msg.tenantId,
          locationId: p.locationId,
          hostEmployeeId: msg.actorId,
          status: "pre_approved",
          purpose: "Recurring pass",
          passType: "recurring",
          visitorName: p.visitorName,
          visitorPhone: p.visitorPhone,
          source: "portal",
          createdBy: msg.actorId,
          updatedBy: msg.actorId,
        });
        const passData = await generatePass(
          {
            visitId: visitRequestId,
            visitorId: p.id,
            tenantId: msg.tenantId,
            locationId: p.locationId,
            validFrom,
            validUntil,
            permittedAreas: [],
            passType: "recurring",
          },
          signingKey,
        );
        await tx.insert(digitalPasses).values({
          id: p.passId,
          tenantId: msg.tenantId,
          visitRequestId,
          locationId: p.locationId,
          passNumber: passData.passNumber,
          status: "active",
          passType: "recurring",
          qrJwt: passData.qrJwt,
          validFrom: passData.validFrom,
          validUntil: passData.validUntil,
          permittedAreas: [],
          createdBy: msg.actorId,
          updatedBy: msg.actorId,
        });
      } catch (err) {
        // An unknown location can never succeed on retry — dead-letter at once with the reason.
        if (isForeignKeyViolation(err)) {
          throw new NonRetryableError(`recurring pass '${p.id}' references an unknown location '${p.locationId}'`);
        }
        throw err;
      }

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
      // BUG FIX: also write into the canonical digital-pass revocation set
      // that gate verification actually checks (see import comment above).
      await addToDigitalPassRevokedSet(msg.tenantId, suspended.passId);
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
      // BUG FIX: also write into the canonical digital-pass revocation set
      // that gate verification actually checks (see import comment above).
      await addToDigitalPassRevokedSet(msg.tenantId, revoked.passId);
    } catch (err) {
      log.warn(
        { err, tenantId: msg.tenantId, passId: p.id, event: "recurring_pass_revocation_sync_failed" },
        "recurring pass revocation-set sync failed on revoke; pass already revoked in DB, set will self-heal",
      );
    }
  });
}
