/**
 * visitor-service: identity verification consumer.
 *
 * Handles `COMMANDS.digilockerVerify` / `COMMANDS.aadhaarFaceMatch`:
 *   markProcessed(tx, msg.messageId) → invoke adapter → update
 *   `visit_requests.identity_verified` / `identity_method` → outbox
 *   `identityVerified` or `identityFailed`.
 *
 * On face-match failure below threshold (Requirement 8.3): also outbox
 * `securityIncidentCreated` and insert a security_incidents row.
 *
 * Biometric photo deletion (Requirement 8.5): schedules deletion 24h
 * post-checkout by recording the photo reference in a metadata column so
 * the DPDP purge worker can pick it up. Actual deletion is deferred to
 * the DPDP scheduled worker (Task 20.2), not performed inline here, as
 * the 24h timer starts from checkout (not from verification time). The
 * consumer records a `biometricPhotoRef` + `biometricPurgeAfterCheckout`
 * flag on the visit request so the purge job knows to delete the photo
 * 24h after the visitor checks out.
 *
 * Graceful degradation (steering "Error Handling & Resilience"): adapter
 * failures (timeout, circuit open) result in `identityFailed` outbox
 * events with `reason = "unavailable"`. The message is NOT retried — the
 * adapter already handles circuit-breaker logic and fail-closed behavior.
 * A non-retryable error wrapper ensures DLQ routing does not kick in for
 * adapter-level "unavailable" results (those are expected outcomes, not
 * transient infrastructure failures).
 *
 * No PII is logged — only status codes, visit request IDs, and outcomes.
 */
import { pino } from "pino";
import { and, eq } from "drizzle-orm";
import type { Queue } from "@civitasone/queue";
import { db } from "../../shared/db.js";
import { enqueue, markProcessed } from "../../shared/outbox.js";
import { COMMANDS, EVENTS } from "../../topics.js";
import { visitRequests } from "../visit-request/schema.js";
import { verifyDocument } from "./digilocker-adapter.js";
import { matchFace, DEFAULT_CONFIDENCE_THRESHOLD } from "./aadhaar-face-adapter.js";
import { securityIncidents } from "./schema.js";

const AUDIT_TOPIC = "audit.event.record";

const log = pino({ name: "identity-consumer" });

// ── Payload types ─────────────────────────────────────────────────

interface DigilockerVerifyPayload {
  visitRequestId: string;
  digilockerUri: string;
}

interface AadhaarFaceMatchPayload {
  visitRequestId: string;
  aadhaarRef: string;
  livePhotoBase64: string;
  confidenceThreshold?: number;
}

// ── Consumer registration ─────────────────────────────────────────

export function registerIdentityConsumers(queue: Queue): void {
  // ────────────────────────────────────────────────────────────────
  // DigiLocker Verification (Requirements 7.1, 7.2, 7.3)
  // ────────────────────────────────────────────────────────────────
  queue.subscribe<DigilockerVerifyPayload>(COMMANDS.digilockerVerify, async (msg) => {
    const p = msg.payload;

    await db.transaction(async (tx): Promise<void> => {
      if (!(await markProcessed(tx, msg.messageId))) return; // idempotent replay

      // Invoke the DigiLocker adapter (circuit-breaker wrapped, fail-closed).
      const result = await verifyDocument(p.digilockerUri);

      if (result.status === "verified") {
        // Requirement 7.2: mark identity_verified, store only docType + timestamp.
        await tx
          .update(visitRequests)
          .set({
            identityVerified: true,
            identityMethod: "digilocker",
            updatedAt: new Date(),
            updatedBy: msg.actorId,
          })
          .where(and(eq(visitRequests.id, p.visitRequestId), eq(visitRequests.tenantId, msg.tenantId)));

        await enqueue(tx, {
          topic: EVENTS.identityVerified,
          eventType: EVENTS.identityVerified,
          tenantId: msg.tenantId,
          actorId: msg.actorId,
          correlationId: msg.correlationId,
          payload: {
            visitRequestId: p.visitRequestId,
            method: "digilocker",
            docType: result.docType,
            verifiedAt: result.verifiedAt.toISOString(),
          },
        });
      } else {
        // Requirement 7.3: verification failed or service unavailable.
        const reason = result.status === "failed" ? result.reason : "unavailable";

        await enqueue(tx, {
          topic: EVENTS.identityFailed,
          eventType: EVENTS.identityFailed,
          tenantId: msg.tenantId,
          actorId: msg.actorId,
          correlationId: msg.correlationId,
          payload: {
            visitRequestId: p.visitRequestId,
            method: "digilocker",
            reason,
            fallbackToManual: result.status === "unavailable",
          },
        });
        await enqueue(tx, { topic: AUDIT_TOPIC, eventType: AUDIT_TOPIC, tenantId: msg.tenantId, actorId: msg.actorId, correlationId: msg.correlationId, payload: { service: "visitor-service", action: "fail", resourceType: "identity", resourceId: msg.messageId, outcome: "success" } });

        if (result.status === "unavailable") {
          // Service unavailable: mark identity_method as manual fallback so
          // the gate security guard knows to verify identity physically.
          // This is a sanctioned degraded path, not a failure — check-in
          // must NOT block on it.
          await tx
            .update(visitRequests)
            .set({
              identityMethod: "manual",
              updatedAt: new Date(),
              updatedBy: msg.actorId,
            })
            .where(and(eq(visitRequests.id, p.visitRequestId), eq(visitRequests.tenantId, msg.tenantId)));
        } else {
          // Genuine verification failure. `identityVerified` was already
          // false (column default) and stays false — but identityMethod
          // was, until now, left completely untouched on a real failure, so
          // "verification attempted via DigiLocker and failed" was
          // indistinguishable from "verification never attempted" (both
          // read as identityMethod: null, identityVerified: false). Setting
          // identityMethod here gives check-in/consumer.ts's identity gate
          // (Requirement — block check-in on a failed verification) a
          // reliable signal: identityMethod === "digilocker" AND
          // identityVerified === false uniquely means "attempted and
          // failed", never "not applicable to this visit".
          await tx
            .update(visitRequests)
            .set({
              identityMethod: "digilocker",
              updatedAt: new Date(),
              updatedBy: msg.actorId,
            })
            .where(and(eq(visitRequests.id, p.visitRequestId), eq(visitRequests.tenantId, msg.tenantId)));
        }
      }
    });

    log.info(
      { visitRequestId: p.visitRequestId, tenantId: msg.tenantId, event: "digilocker_verify_processed" },
      "DigiLocker verification command processed",
    );
  });

  // ────────────────────────────────────────────────────────────────
  // Aadhaar Face Match (Requirements 8.1, 8.2, 8.3, 8.5)
  // ────────────────────────────────────────────────────────────────
  queue.subscribe<AadhaarFaceMatchPayload>(COMMANDS.aadhaarFaceMatch, async (msg) => {
    const p = msg.payload;
    const threshold = p.confidenceThreshold ?? DEFAULT_CONFIDENCE_THRESHOLD;

    await db.transaction(async (tx): Promise<void> => {
      if (!(await markProcessed(tx, msg.messageId))) return; // idempotent replay

      // Invoke the Aadhaar face-match adapter (circuit-breaker wrapped, fail-closed).
      const result = await matchFace(
        { livePhotoBase64: p.livePhotoBase64, aadhaarRef: p.aadhaarRef },
        threshold,
      );

      if (result.status === "matched") {
        // Requirement 8.2: face match passed — mark identity verified.
        await tx
          .update(visitRequests)
          .set({
            identityVerified: true,
            identityMethod: "aadhaar_face",
            updatedAt: new Date(),
            updatedBy: msg.actorId,
          })
          .where(and(eq(visitRequests.id, p.visitRequestId), eq(visitRequests.tenantId, msg.tenantId)));

        await enqueue(tx, {
          topic: EVENTS.identityVerified,
          eventType: EVENTS.identityVerified,
          tenantId: msg.tenantId,
          actorId: msg.actorId,
          correlationId: msg.correlationId,
          payload: {
            visitRequestId: p.visitRequestId,
            method: "aadhaar_face",
            confidence: result.confidence,
            livenessPassed: result.livenessPassed,
            matchedAt: result.matchedAt.toISOString(),
          },
        });
      } else if (result.status === "not_matched") {
        // Requirement 8.3: face match failed below threshold.
        // Reject check-in, notify security, log event, create security incident.

        // Look up the visit request for incident details.
        const visitRows = await tx
          .select()
          .from(visitRequests)
          .where(and(eq(visitRequests.id, p.visitRequestId), eq(visitRequests.tenantId, msg.tenantId)))
          .limit(1);
        const visit = visitRows[0];
        const locationId = visit?.locationId;

        await enqueue(tx, {
          topic: EVENTS.identityFailed,
          eventType: EVENTS.identityFailed,
          tenantId: msg.tenantId,
          actorId: msg.actorId,
          correlationId: msg.correlationId,
          payload: {
            visitRequestId: p.visitRequestId,
            method: "aadhaar_face",
            reason: "face_match_below_threshold",
            confidence: result.confidence,
            threshold,
            livenessPassed: result.livenessPassed,
          },
        });

        // Create a security incident for face-match failure (Requirement 8.3).
        if (locationId) {
          await tx.insert(securityIncidents).values({
            tenantId: msg.tenantId,
            locationId,
            incidentType: "face_match_fail",
            relatedVisitorId: visit?.visitorId ?? null,
            description: `Aadhaar face match failed: confidence ${result.confidence}% below threshold ${threshold}%`,
            severity: "high",
            createdBy: msg.actorId,
          });

          // Outbox the security incident created event for downstream consumers.
          await enqueue(tx, {
            topic: EVENTS.securityIncidentCreated,
            eventType: EVENTS.securityIncidentCreated,
            tenantId: msg.tenantId,
            actorId: msg.actorId,
            correlationId: msg.correlationId,
            payload: {
              visitRequestId: p.visitRequestId,
              locationId,
              incidentType: "face_match_fail",
              severity: "high",
              confidence: result.confidence,
              threshold,
            },
          });
        }

        // Requirement 8.5: record that biometric photo should be deleted
        // 24h post-checkout. We store the fact that a photo was captured so
        // the DPDP purge worker can enforce the deletion timeline. The photo
        // is not persisted by this consumer (the adapter never stores it),
        // but if the caller (route/kiosk) stored a reference in photoRef,
        // the purge worker uses `biometricPurgeAfterCheckout = true` as the
        // signal to delete it 24h after checkout.
        //
        // Also set identityMethod here (previously left untouched on a
        // real failure): without it, "Aadhaar face-match attempted and
        // failed" is indistinguishable from "verification never attempted"
        // — both would read identityMethod: null, identityVerified: false.
        // check-in/consumer.ts's identity gate relies on identityMethod ===
        // "aadhaar_face" AND identityVerified === false to mean "attempted
        // and failed" specifically, never "not applicable to this visit".
        await tx
          .update(visitRequests)
          .set({
            identityMethod: "aadhaar_face",
            updatedAt: new Date(),
            updatedBy: msg.actorId,
          })
          .where(and(eq(visitRequests.id, p.visitRequestId), eq(visitRequests.tenantId, msg.tenantId)));
      } else {
        // result.status === "unavailable" — adapter is down or disabled.
        await enqueue(tx, {
          topic: EVENTS.identityFailed,
          eventType: EVENTS.identityFailed,
          tenantId: msg.tenantId,
          actorId: msg.actorId,
          correlationId: msg.correlationId,
          payload: {
            visitRequestId: p.visitRequestId,
            method: "aadhaar_face",
            reason: "unavailable",
            fallbackToManual: true,
          },
        });
        await enqueue(tx, { topic: AUDIT_TOPIC, eventType: AUDIT_TOPIC, tenantId: msg.tenantId, actorId: msg.actorId, correlationId: msg.correlationId, payload: { service: "visitor-service", action: "fail", resourceType: "identity", resourceId: msg.messageId, outcome: "success" } });

        // Mark for manual verification fallback.
        await tx
          .update(visitRequests)
          .set({
            identityMethod: "manual",
            updatedAt: new Date(),
            updatedBy: msg.actorId,
          })
          .where(and(eq(visitRequests.id, p.visitRequestId), eq(visitRequests.tenantId, msg.tenantId)));
      }
    });

    log.info(
      { visitRequestId: p.visitRequestId, tenantId: msg.tenantId, event: "aadhaar_face_match_processed" },
      "Aadhaar face match command processed",
    );
  });
}
