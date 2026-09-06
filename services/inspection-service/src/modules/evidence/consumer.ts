/**
 * inspection-service: evidence module — command consumers.
 *
 * Each handler follows the CivitasOne CQRS consumer contract:
 *   1. markProcessed(tx, msg.messageId) — idempotency guard
 *   2. Business write (insert/update) inside the same transaction
 *   3. Outbox: domain event + audit event (same transaction — atomicity)
 *   4. Cache invalidation (outside transaction — best-effort)
 *
 * evidenceRegister: store metadata → create chain_of_custody "upload" entry → emit event
 *
 * evidenceVerifyIntegrity: recompute hash → compare → update integrityStatus → emit tampered event if mismatch
 *
 * _Requirements: 7.1, 7.2, 7.4, 7.5_
 */
import { pino } from "pino";
import type { Queue } from "@civitasone/queue";
import { db } from "../../shared/db.js";
import { enqueue, markProcessed } from "../../shared/outbox.js";
import { cache, invalidateSafely } from "../../shared/infra.js";
import { COMMANDS, EVENTS } from "../../topics.js";
import { decideIntegrity } from "./domain.js";
import { resolveStorageConfig, fetchObjectSha256 } from "./storage.js";
import {
  insertEvidence,
  insertCustodyEntry,
  updateEvidenceIntegrity,
  findEvidenceById,
} from "./repo.js";
import type { EvidenceRegisterPayload, EvidenceVerifyIntegrityPayload } from "./commands.js";

const log = pino({ name: "evidence-consumer" });

const AUDIT_TOPIC = "audit.event.record";

// ── Registration ─────────────────────────────────────────────────────────────

export function registerEvidenceConsumers(queue: Queue): void {
  // ─── evidenceRegister ─────────────────────────────────────────────────────
  queue.subscribe<EvidenceRegisterPayload & { evidenceId: string; tenantId: string }>(
    COMMANDS.evidenceRegister,
    async (msg) => {
      const p = msg.payload;
      let evidenceId: string | undefined;

      await db.transaction(async (tx) => {
        if (!(await markProcessed(tx, msg.messageId))) return;

        // 1. Store evidence metadata (Req 7.1, 7.2)
        const evidence = await insertEvidence(tx, {
          id: p.evidenceId,
          tenantId: msg.tenantId,
          inspectionId: p.inspectionId,
          findingId: p.findingId ?? null,
          sha256Hash: p.sha256Hash,
          s3Key: p.s3Key,
          mimeType: p.mimeType,
          fileSizeBytes: p.fileSizeBytes,
          integrityStatus: "valid",
          captureLatitude: p.captureLatitude ?? null,
          captureLongitude: p.captureLongitude ?? null,
          captureTimestamp: new Date(p.captureTimestamp),
          deviceId: p.deviceId,
          inspectorId: p.inspectorId,
          createdBy: msg.actorId,
        });

        evidenceId = evidence.id;

        // 2. Create chain of custody "upload" entry (Req 7.5)
        await insertCustodyEntry(tx, {
          tenantId: msg.tenantId,
          evidenceId: evidence.id,
          action: "upload",
          actorId: msg.actorId,
          details: {
            deviceId: p.deviceId,
            mimeType: p.mimeType,
            fileSizeBytes: p.fileSizeBytes,
            sha256Hash: p.sha256Hash,
          },
        });

        // 3. Domain event: evidence registered (Req 7.1)
        await enqueue(tx, {
          topic: EVENTS.evidenceRegistered,
          eventType: EVENTS.evidenceRegistered,
          tenantId: msg.tenantId,
          actorId: msg.actorId,
          correlationId: msg.correlationId,
          payload: {
            evidenceId: evidence.id,
            inspectionId: p.inspectionId,
            fileType: p.mimeType,
            sha256: p.sha256Hash,
            storagePath: p.s3Key,
          },
        });

        // 4. Audit event
        await enqueue(tx, {
          topic: AUDIT_TOPIC,
          eventType: AUDIT_TOPIC,
          tenantId: msg.tenantId,
          actorId: msg.actorId,
          correlationId: msg.correlationId,
          payload: {
            action: "evidence.registered",
            resourceType: "evidence_artifact",
            resourceId: evidence.id,
            details: {
              inspectionId: p.inspectionId,
              mimeType: p.mimeType,
              fileSizeBytes: p.fileSizeBytes,
              deviceId: p.deviceId,
            },
          },
        });
      });

      // Cache invalidation (outside transaction, best-effort)
      if (evidenceId) {
        await invalidateSafely(
          cache.makeKey(msg.tenantId, "evidence", evidenceId), log,
          { tenantId: msg.tenantId, evidenceId }, "failed to invalidate evidence cache after register",
        );
      }
    },
  );

  // ─── evidenceVerifyIntegrity ──────────────────────────────────────────────
  queue.subscribe<EvidenceVerifyIntegrityPayload & { tenantId: string }>(
    COMMANDS.evidenceVerifyIntegrity,
    async (msg) => {
      const p = msg.payload;

      // Load current evidence to get stored hash
      const evidence = await findEvidenceById(msg.tenantId, p.evidenceId);
      if (!evidence) {
        log.warn({ tenantId: msg.tenantId, evidenceId: p.evidenceId, event: "evidence_not_found" },
          "evidence artifact not found for integrity verification");
        return;
      }

      // Recompute the SHA-256 from the object actually stored in S3 and compare it
      // against the hash the client declared at upload. Env-gated: when storage is
      // unconfigured or the object is not retrievable, `computedHash` is null and the
      // artifact is marked `unverified` — we NEVER assert `valid` without proof.
      const storageConfig = resolveStorageConfig();
      let computedHash: string | null = null;
      if (storageConfig) {
        computedHash = await fetchObjectSha256(storageConfig, evidence.s3Key);
      }

      const integrityStatus = decideIntegrity(evidence.sha256Hash, computedHash);

      await db.transaction(async (tx) => {
        if (!(await markProcessed(tx, msg.messageId))) return;

        // Update integrity status (Req 7.4)
        await updateEvidenceIntegrity(tx, p.evidenceId, msg.tenantId, integrityStatus);

        // Chain of custody: verification event (Req 7.5)
        await insertCustodyEntry(tx, {
          tenantId: msg.tenantId,
          evidenceId: p.evidenceId,
          action: "verify",
          actorId: msg.actorId,
          details: {
            integrityStatus,
            storedHash: evidence.sha256Hash,
            computedHash: computedHash ?? "unavailable",
          },
        });

        // If tampered, emit tampered event (Req 7.4)
        if (integrityStatus === "tampered") {
          await enqueue(tx, {
            topic: EVENTS.evidenceTampered,
            eventType: EVENTS.evidenceTampered,
            tenantId: msg.tenantId,
            actorId: msg.actorId,
            correlationId: msg.correlationId,
            payload: {
              evidenceId: p.evidenceId,
              inspectionId: evidence.inspectionId,
              expectedHash: evidence.sha256Hash,
              actualHash: computedHash ?? "unavailable",
            },
          });
        }

        // Audit event
        await enqueue(tx, {
          topic: AUDIT_TOPIC,
          eventType: AUDIT_TOPIC,
          tenantId: msg.tenantId,
          actorId: msg.actorId,
          correlationId: msg.correlationId,
          payload: {
            action: "evidence.integrity_verified",
            resourceType: "evidence_artifact",
            resourceId: p.evidenceId,
            details: {
              integrityStatus,
              storedHash: evidence.sha256Hash,
              computedHash: computedHash ?? "unavailable",
            },
          },
        });
      });

      // Cache invalidation (outside transaction, best-effort)
      await invalidateSafely(
        cache.makeKey(msg.tenantId, "evidence", p.evidenceId), log,
        { tenantId: msg.tenantId, evidenceId: p.evidenceId }, "failed to invalidate evidence cache after integrity check",
      );
    },
  );
}
