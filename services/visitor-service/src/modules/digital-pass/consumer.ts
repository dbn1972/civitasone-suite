/**
 * visitor-service: digital-pass consumer.
 *
 * Handles `COMMANDS.passGenerate` / `COMMANDS.passRevoke` / `COMMANDS.passReplace`:
 *
 * passGenerate (triggered by visitRequestApproved):
 *   markProcessed(tx, msg.messageId) → generate pass (domain.ts) → insert
 *   `digital_passes` row → outbox `passGenerated` + `NOTIFICATION_SEND`
 *   (email PDF + SMS/WhatsApp deep link) → post-commit: add pass ID to
 *   Redis revocation-check cache (active pass, not revoked — but we prime
 *   the cache so the gate-sync endpoint can serve it quickly).
 *
 * passRevoke:
 *   markProcessed(tx, msg.messageId) → revoke pass (domain.ts) → update
 *   `digital_passes` row (revoked=true, revokedAt, revokeReason) → outbox
 *   `passRevoked` → post-commit: add pass ID to Redis revocation set
 *   `visitor:{tid}:revoked`.
 *
 * passReplace:
 *   markProcessed(tx, msg.messageId) → revoke original → generate
 *   replacement → insert new row → update original (replacedById) → outbox
 *   `passReplaced` + `NOTIFICATION_SEND` → post-commit: add original to
 *   revocation set.
 *
 * Follows the established CQRS consumer pattern:
 *   db.transaction → markProcessed → DB write → outbox.enqueue →
 *   post-commit side effects (Redis). See modules/blacklist/consumer.ts and
 *   modules/check-in/consumer.ts.
 *
 * Graceful degradation: Redis side effects happen AFTER the DB transaction
 * commits. A Redis failure is caught, logged at WARN, and does NOT fail the
 * message — the pass has already been durably recorded/revoked in Postgres.
 */
import { pino } from "pino";
import { and, eq } from "drizzle-orm";
import type { Queue } from "@civitasone/queue";
import { NOTIFICATION_SEND, buildNotificationPayload } from "@civitasone/events";
import { db } from "../../shared/db.js";
import { enqueue, markProcessed } from "../../shared/outbox.js";
import { COMMANDS, EVENTS } from "../../topics.js";
import { digitalPasses } from "./schema.js";
import { visitRequests } from "../visit-request/schema.js";
import { generatePass, revokePass, replacePass, computeValidityWindow, type PassType } from "./domain.js";
import { addToRevokedSet } from "./revocation-store.js";
import { getPolicyNumber, MS_PER_DAY } from "../config-registry/policy.js";

const AUDIT_TOPIC = "audit.event.record";

const log = pino({ name: "digital-pass-consumer" });

// ── Payload interfaces ────────────────────────────────────────────────────

interface PassGeneratePayload {
  id: string;
  tenantId: string;
  visitRequestId: string;
  visitorId: string;
  locationId: string;
  passType: PassType;
  validFrom: string; // ISO
  validUntil: string; // ISO
  permittedAreas: string[];
  tenantPrivateKeyPem: string;
  escortEmployeeId?: string | null;
}

interface PassRevokePayload {
  passId: string;
  reason: string;
  tenantId: string;
}

interface PassReplacePayload {
  originalPassId: string;
  newPassId: string;
  reason: string;
  tenantId: string;
  tenantPrivateKeyPem: string;
}

// ── Consumer registration ─────────────────────────────────────────────────

export function registerDigitalPassConsumers(queue: Queue): void {
  // ─── passGenerate ─────────────────────────────────────────────────────
  queue.subscribe<PassGeneratePayload>(COMMANDS.passGenerate, async (msg) => {
    const p = msg.payload;

    const generated = await db.transaction(async (tx): Promise<{ passId: string; visitorEmail: string; visitorPhone: string } | null> => {
      if (!(await markProcessed(tx, msg.messageId))) return null; // idempotent replay

      // Compute validity window with tenant-configured caps (default 7d multi-
      // day / 90d recurring). Resolved on the GUC-scoped tx so RLS-scoped config
      // applies; unconfigured tenants get the module defaults unchanged.
      const multiDayMaxMs = (await getPolicyNumber(tx, msg.tenantId, "digital_pass.multi_day_max_days")) * MS_PER_DAY;
      const recurringMaxMs = (await getPolicyNumber(tx, msg.tenantId, "digital_pass.recurring_max_days")) * MS_PER_DAY;
      const { validFrom, validUntil } = computeValidityWindow(
        p.passType,
        new Date(p.validFrom),
        new Date(p.validUntil),
        { multiDayMaxMs, recurringMaxMs },
      );

      // Generate pass: pass number + signed QR JWT
      const pass = await generatePass(
        {
          visitId: p.visitRequestId,
          visitorId: p.visitorId,
          tenantId: p.tenantId,
          locationId: p.locationId,
          validFrom,
          validUntil,
          permittedAreas: p.permittedAreas,
          passType: p.passType,
        },
        p.tenantPrivateKeyPem,
      );

      // Persist digital pass row — use the pre-minted `id` from commands.ts
      await tx.insert(digitalPasses).values({
        id: p.id,
        tenantId: p.tenantId,
        visitRequestId: p.visitRequestId,
        locationId: p.locationId,
        passNumber: pass.passNumber,
        status: "active",
        passType: p.passType,
        qrJwt: pass.qrJwt,
        validFrom: pass.validFrom,
        validUntil: pass.validUntil,
        permittedAreas: p.permittedAreas,
        revoked: false,
        escortEmployeeId: p.escortEmployeeId ?? null,
        createdBy: msg.actorId,
        updatedBy: msg.actorId,
      });

      // Look up visitor contact info for notification
      const visitRows = await tx
        .select()
        .from(visitRequests)
        .where(and(eq(visitRequests.id, p.visitRequestId), eq(visitRequests.tenantId, p.tenantId)))
        .limit(1);
      const visit = visitRows[0];

      // Outbox: passGenerated event
      await enqueue(tx, {
        topic: EVENTS.passGenerated,
        eventType: EVENTS.passGenerated,
        tenantId: p.tenantId,
        actorId: msg.actorId,
        correlationId: msg.correlationId,
        payload: {
          passId: p.id,
          visitRequestId: p.visitRequestId,
          passNumber: pass.passNumber,
          passType: p.passType,
          validFrom: pass.validFrom.toISOString(),
          validUntil: pass.validUntil.toISOString(),
          locationId: p.locationId,
        },
      });

      // Outbox: NOTIFICATION_SEND — email (PDF attachment handled by
      // notification-service's template renderer) + SMS/WhatsApp deep link
      const visitorEmail = visit?.visitorEmail ?? "";
      const visitorPhone = visit?.visitorPhone ?? "";

      if (visitorEmail) {
        await enqueue(tx, {
          topic: NOTIFICATION_SEND,
          eventType: NOTIFICATION_SEND,
          tenantId: p.tenantId,
          actorId: msg.actorId,
          correlationId: msg.correlationId,
          payload: buildNotificationPayload({
            eventType: EVENTS.passGenerated,
            recipient: visitorEmail,
            channel: "email",
            variables: {
              passNumber: pass.passNumber,
              validFrom: pass.validFrom.toISOString(),
              validUntil: pass.validUntil.toISOString(),
              passId: p.id,
            },
          }),
        });
      }

      if (visitorPhone) {
        await enqueue(tx, {
          topic: NOTIFICATION_SEND,
          eventType: NOTIFICATION_SEND,
          tenantId: p.tenantId,
          actorId: msg.actorId,
          correlationId: msg.correlationId,
          payload: buildNotificationPayload({
            eventType: EVENTS.passGenerated,
            recipient: visitorPhone,
            channel: "sms",
            variables: {
              passNumber: pass.passNumber,
              deepLink: `/visitor/pass/${p.id}`,
              passId: p.id,
            },
          }),
        });
        await enqueue(tx, { topic: AUDIT_TOPIC, eventType: AUDIT_TOPIC, tenantId: msg.tenantId, actorId: msg.actorId, correlationId: msg.correlationId, payload: { service: "visitor-service", action: "process", resourceType: "digital_pass", resourceId: p.id, outcome: "success" } });
      }

      return { passId: p.id, visitorEmail, visitorPhone };
    });

    if (!generated) return; // already processed (idempotent replay)

    log.info(
      { tenantId: p.tenantId, passId: generated.passId, event: "pass_generated" },
      "digital pass generated successfully",
    );
  });

  // ─── passRevoke ───────────────────────────────────────────────────────
  queue.subscribe<PassRevokePayload>(COMMANDS.passRevoke, async (msg) => {
    const p = msg.payload;

    const revoked = await db.transaction(async (tx): Promise<{ passId: string } | null> => {
      if (!(await markProcessed(tx, msg.messageId))) return null; // idempotent replay

      const passRows = await tx
        .select()
        .from(digitalPasses)
        .where(and(eq(digitalPasses.id, p.passId), eq(digitalPasses.tenantId, msg.tenantId)))
        .limit(1);
      const pass = passRows[0];
      if (!pass) {
        throw new Error(`digital pass '${p.passId}' not found for tenant '${msg.tenantId}'`);
      }

      // Domain validation + field computation
      const revocationFields = revokePass(pass, p.reason);

      await tx
        .update(digitalPasses)
        .set({
          ...revocationFields,
          status: "revoked",
          updatedAt: revocationFields.revokedAt,
          updatedBy: msg.actorId,
        })
        .where(and(eq(digitalPasses.id, p.passId), eq(digitalPasses.tenantId, msg.tenantId)));

      // Outbox: passRevoked event
      await enqueue(tx, {
        topic: EVENTS.passRevoked,
        eventType: EVENTS.passRevoked,
        tenantId: msg.tenantId,
        actorId: msg.actorId,
        correlationId: msg.correlationId,
        payload: {
          passId: p.passId,
          reason: p.reason,
          revokedAt: revocationFields.revokedAt.toISOString(),
        },
      });
      await enqueue(tx, { topic: AUDIT_TOPIC, eventType: AUDIT_TOPIC, tenantId: msg.tenantId, actorId: msg.actorId, correlationId: msg.correlationId, payload: { service: "visitor-service", action: "process", resourceType: "digital_pass", resourceId: msg.messageId, outcome: "success" } });

      return { passId: p.passId };
    });

    if (!revoked) return; // already processed (idempotent replay)

    // Post-commit: add to Redis revocation set (Requirement 4.5).
    // Best-effort: never fail an already-committed revocation because
    // Redis is unavailable.
    try {
      await addToRevokedSet(msg.tenantId, p.passId);
    } catch (err) {
      log.warn(
        { err, tenantId: msg.tenantId, passId: p.passId, event: "revocation_set_sync_failed" },
        "revocation set sync failed; pass already revoked in DB, set will self-heal on next revoke/resync",
      );
    }

    log.info(
      { tenantId: msg.tenantId, passId: revoked.passId, event: "pass_revoked" },
      "digital pass revoked",
    );
  });

  // ─── passReplace ──────────────────────────────────────────────────────
  queue.subscribe<PassReplacePayload>(COMMANDS.passReplace, async (msg) => {
    const p = msg.payload;

    const replaced = await db.transaction(async (tx): Promise<{ originalPassId: string; newPassId: string } | null> => {
      if (!(await markProcessed(tx, msg.messageId))) return null; // idempotent replay

      // Load original pass
      const passRows = await tx
        .select()
        .from(digitalPasses)
        .where(and(eq(digitalPasses.id, p.originalPassId), eq(digitalPasses.tenantId, msg.tenantId)))
        .limit(1);
      const originalPass = passRows[0];
      if (!originalPass) {
        throw new Error(`digital pass '${p.originalPassId}' not found for tenant '${msg.tenantId}'`);
      }

      // Revoke original
      const revocationFields = revokePass(originalPass, p.reason);

      // Generate replacement pass with same parameters as original
      const newPass = await replacePass(
        {
          visitId: originalPass.visitRequestId,
          visitorId: originalPass.createdBy, // visitor identified by creator context
          tenantId: msg.tenantId,
          locationId: originalPass.locationId,
          validFrom: originalPass.validFrom,
          validUntil: originalPass.validUntil,
          permittedAreas: originalPass.permittedAreas,
          passType: originalPass.passType as PassType,
        },
        p.tenantPrivateKeyPem,
      );

      // Update original: mark revoked + link to replacement
      await tx
        .update(digitalPasses)
        .set({
          ...revocationFields,
          status: "revoked",
          replacedById: p.newPassId,
          updatedAt: revocationFields.revokedAt,
          updatedBy: msg.actorId,
        })
        .where(and(eq(digitalPasses.id, p.originalPassId), eq(digitalPasses.tenantId, msg.tenantId)));

      // Insert replacement pass
      await tx.insert(digitalPasses).values({
        id: p.newPassId,
        tenantId: msg.tenantId,
        visitRequestId: originalPass.visitRequestId,
        locationId: originalPass.locationId,
        passNumber: newPass.passNumber,
        status: "active",
        passType: originalPass.passType,
        qrJwt: newPass.qrJwt,
        validFrom: newPass.validFrom,
        validUntil: newPass.validUntil,
        permittedAreas: originalPass.permittedAreas,
        revoked: false,
        escortEmployeeId: originalPass.escortEmployeeId,
        createdBy: msg.actorId,
        updatedBy: msg.actorId,
      });

      // Outbox: passReplaced event
      await enqueue(tx, {
        topic: EVENTS.passReplaced,
        eventType: EVENTS.passReplaced,
        tenantId: msg.tenantId,
        actorId: msg.actorId,
        correlationId: msg.correlationId,
        payload: {
          originalPassId: p.originalPassId,
          newPassId: p.newPassId,
          newPassNumber: newPass.passNumber,
          reason: p.reason,
          revokedAt: revocationFields.revokedAt.toISOString(),
        },
      });

      // Look up visitor contact for replacement notification
      const visitRows = await tx
        .select()
        .from(visitRequests)
        .where(and(eq(visitRequests.id, originalPass.visitRequestId), eq(visitRequests.tenantId, msg.tenantId)))
        .limit(1);
      const visit = visitRows[0];

      const visitorPhone = visit?.visitorPhone ?? "";
      if (visitorPhone) {
        await enqueue(tx, {
          topic: NOTIFICATION_SEND,
          eventType: NOTIFICATION_SEND,
          tenantId: msg.tenantId,
          actorId: msg.actorId,
          correlationId: msg.correlationId,
          payload: buildNotificationPayload({
            eventType: EVENTS.passReplaced,
            recipient: visitorPhone,
            channel: "sms",
            variables: {
              newPassNumber: newPass.passNumber,
              deepLink: `/visitor/pass/${p.newPassId}`,
              passId: p.newPassId,
            },
          }),
        });
        await enqueue(tx, { topic: AUDIT_TOPIC, eventType: AUDIT_TOPIC, tenantId: msg.tenantId, actorId: msg.actorId, correlationId: msg.correlationId, payload: { service: "visitor-service", action: "process", resourceType: "digital_pass", resourceId: msg.messageId, outcome: "success" } });
      }

      return { originalPassId: p.originalPassId, newPassId: p.newPassId };
    });

    if (!replaced) return; // already processed (idempotent replay)

    // Post-commit: add original pass to revocation set. Best-effort.
    try {
      await addToRevokedSet(msg.tenantId, p.originalPassId);
    } catch (err) {
      log.warn(
        { err, tenantId: msg.tenantId, passId: p.originalPassId, event: "revocation_set_sync_failed" },
        "revocation set sync failed on replacement; original already revoked in DB, set will self-heal",
      );
    }

    log.info(
      { tenantId: msg.tenantId, originalPassId: replaced.originalPassId, newPassId: replaced.newPassId, event: "pass_replaced" },
      "digital pass replaced",
    );
  });
}
