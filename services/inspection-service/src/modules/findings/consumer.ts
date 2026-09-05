/**
 * inspection-service: findings module — command consumers.
 *
 * Each handler follows the CivitasOne CQRS consumer contract:
 *   1. markProcessed(tx, msg.messageId) — idempotency guard
 *   2. Business write (insert/update) inside the same transaction
 *   3. Outbox: domain event + audit event (same transaction — atomicity)
 *   4. Cache invalidation (outside transaction — best-effort)
 *
 * findingCreate: derive severity from provision → generate findingNumber → insert → emit event
 * complianceNoticeCreate: insert notice → transition finding to notice_issued → set due date
 * findingVerifyResolved: validate evidence → transition to closed → record closure
 *
 * _Requirements: 9.1, 9.2, 9.3, 9.4, 9.5, 9.6, 9.7, 9.8_
 */
import { pino } from "pino";
import type { Queue } from "@civitasone/queue";
import { NonRetryableError } from "@civitasone/queue";
import { db } from "../../shared/db.js";
import { enqueue, markProcessed } from "../../shared/outbox.js";
import { cache, invalidateSafely } from "../../shared/infra.js";
import { COMMANDS, EVENTS } from "../../topics.js";
import {
  deriveSeverity,
  generateFindingNumber,
  assertValidFindingTransition,
  assertDeletionAllowed,
  DomainError,
  type FindingState,
} from "./domain.js";
import {
  insertFinding,
  insertComplianceNotice,
  updateFindingState,
  nextFindingSequence,
  findFindingById,
  softDeleteFinding,
} from "./repo.js";
import { findInspectionById } from "../execution/repo.js";
import { findProvisionById } from "../universe/repo.js";
import type {
  FindingCreatePayload,
  ComplianceNoticeCreatePayload,
  FindingVerifyResolvedPayload,
  FindingSoftDeletePayload,
} from "./commands.js";

const log = pino({ name: "findings-consumer" });

const AUDIT_TOPIC = "audit.event.record";
const NOTIFICATION_TOPIC = "notification.send";

// ── Registration ─────────────────────────────────────────────────────────────

export function registerFindingsConsumers(queue: Queue): void {
  // ─── findingCreate ────────────────────────────────────────────────────────
  queue.subscribe<FindingCreatePayload & { tenantId: string }>(
    COMMANDS.findingCreate,
    async (msg) => {
      const p = msg.payload;
      let findingId: string | undefined;

      await db.transaction(async (tx) => {
        if (!(await markProcessed(tx, msg.messageId))) return;

        // 1. Look up linked provision to derive severity (Req 9.2)
        const provision = await findProvisionById(msg.tenantId, p.provisionId);
        if (!provision) {
          throw new NonRetryableError(
            `Provision not found: ${p.provisionId} (tenant: ${msg.tenantId})`,
          );
        }

        let severity: string;
        try {
          severity = deriveSeverity(provision.severityClass);
        } catch (err) {
          if (err instanceof DomainError) {
            throw new NonRetryableError(err.message);
          }
          throw err;
        }

        // 2. Generate finding number: FND-{YYYY}-{SEQ:6} (Req 9.3)
        const year = new Date().getFullYear();
        const seq = await nextFindingSequence(tx, msg.tenantId, year);
        const findingNumber = generateFindingNumber(year, seq);

        // 3. Insert finding (Req 9.1)
        const finding = await insertFinding(tx, {
          tenantId: msg.tenantId,
          findingNumber,
          inspectionId: p.inspectionId,
          questionId: p.questionId ?? "",
          provisionId: p.provisionId,
          severity,
          description: p.description,
          state: "open",
          evidenceIds: p.evidenceIds ?? [],
          createdBy: msg.actorId,
          updatedBy: msg.actorId,
        });

        findingId = finding.id;

        // 4. Domain event via outbox (Req 9.1)
        await enqueue(tx, {
          topic: EVENTS.findingCreated,
          eventType: EVENTS.findingCreated,
          tenantId: msg.tenantId,
          actorId: msg.actorId,
          correlationId: msg.correlationId,
          payload: {
            findingId: finding.id,
            findingNumber: finding.findingNumber,
            inspectionId: finding.inspectionId,
            provisionId: finding.provisionId,
            severity: finding.severity,
            entityId: p.inspectionId, // inspection context
          },
        });

        // 5. Audit event
        await enqueue(tx, {
          topic: AUDIT_TOPIC,
          eventType: AUDIT_TOPIC,
          tenantId: msg.tenantId,
          actorId: msg.actorId,
          correlationId: msg.correlationId,
          payload: {
            action: "finding.created",
            resourceType: "finding",
            resourceId: finding.id,
            details: {
              findingNumber: finding.findingNumber,
              severity: finding.severity,
              provisionId: finding.provisionId,
              inspectionId: finding.inspectionId,
            },
          },
        });
      });

      // Cache invalidation (outside transaction, best-effort)
      if (findingId) {
        await invalidateSafely(
          cache.makeKey(msg.tenantId, "finding", findingId), log,
          { tenantId: msg.tenantId, findingId }, "failed to invalidate finding cache after create",
        );
      }
    },
  );

  // ─── complianceNoticeCreate ───────────────────────────────────────────────
  queue.subscribe<ComplianceNoticeCreatePayload & { tenantId: string }>(
    COMMANDS.complianceNoticeCreate,
    async (msg) => {
      const p = msg.payload;
      let findingId: string | undefined;

      await db.transaction(async (tx) => {
        if (!(await markProcessed(tx, msg.messageId))) return;

        // 1. Load finding and validate it exists
        const finding = await findFindingById(msg.tenantId, p.findingId);
        if (!finding) {
          throw new NonRetryableError(
            `Finding not found: ${p.findingId} (tenant: ${msg.tenantId})`,
          );
        }

        // 2. Validate state transition: open → notice_issued (Req 9.4, 9.5)
        const currentState = finding.state as FindingState;
        try {
          assertValidFindingTransition(currentState, "notice_issued");
        } catch (err) {
          if (err instanceof DomainError) {
            throw new NonRetryableError(err.message);
          }
          throw err;
        }

        // 3. Insert compliance notice (Req 9.4)
        const notice = await insertComplianceNotice(tx, {
          tenantId: msg.tenantId,
          findingId: p.findingId,
          dueDate: p.dueDate,
          requiredAction: p.requiredAction,
          responsibleParty: p.responsibleParty,
          createdBy: msg.actorId,
          updatedBy: msg.actorId,
        });

        // 4. Transition finding to notice_issued (Req 9.5)
        await updateFindingState(
          tx,
          p.findingId,
          msg.tenantId,
          "notice_issued",
          msg.actorId,
        );

        findingId = p.findingId;

        // 5. Notification — inform responsible party (Req 9.5)
        await enqueue(tx, {
          topic: NOTIFICATION_TOPIC,
          eventType: NOTIFICATION_TOPIC,
          tenantId: msg.tenantId,
          actorId: msg.actorId,
          correlationId: msg.correlationId,
          payload: {
            type: "finding.compliance_notice_issued",
            recipientIds: [p.responsibleParty],
            data: {
              findingId: p.findingId,
              findingNumber: finding.findingNumber,
              dueDate: p.dueDate,
              requiredAction: p.requiredAction,
              noticeId: notice.id,
            },
          },
        });

        // 6. Audit event
        await enqueue(tx, {
          topic: AUDIT_TOPIC,
          eventType: AUDIT_TOPIC,
          tenantId: msg.tenantId,
          actorId: msg.actorId,
          correlationId: msg.correlationId,
          payload: {
            action: "compliance_notice.created",
            resourceType: "compliance_notice",
            resourceId: notice.id,
            details: {
              findingId: p.findingId,
              dueDate: p.dueDate,
              requiredAction: p.requiredAction,
              responsibleParty: p.responsibleParty,
            },
          },
        });
      });

      // Cache invalidation (outside transaction, best-effort)
      if (findingId) {
        await invalidateSafely(
          cache.makeKey(msg.tenantId, "finding", findingId), log,
          { tenantId: msg.tenantId, findingId }, "failed to invalidate finding cache after compliance notice",
        );
      }
    },
  );

  // ─── findingVerifyResolved ────────────────────────────────────────────────
  queue.subscribe<FindingVerifyResolvedPayload & { tenantId: string }>(
    COMMANDS.findingVerifyResolved,
    async (msg) => {
      const p = msg.payload;
      let findingId: string | undefined;

      await db.transaction(async (tx) => {
        if (!(await markProcessed(tx, msg.messageId))) return;

        // 1. Load finding and validate it exists
        const finding = await findFindingById(msg.tenantId, p.findingId);
        if (!finding) {
          throw new NonRetryableError(
            `Finding not found: ${p.findingId} (tenant: ${msg.tenantId})`,
          );
        }

        // 2. Validate state transition: open/notice_issued/overdue → closed (Req 9.6)
        const currentState = finding.state as FindingState;
        try {
          assertValidFindingTransition(currentState, "closed");
        } catch (err) {
          if (err instanceof DomainError) {
            throw new NonRetryableError(err.message);
          }
          throw err;
        }

        // 3. Transition to closed with verification evidence (Req 9.6)
        const now = new Date();
        const verificationEvidence = {
          evidenceIds: p.verificationEvidenceIds ?? [],
          notes: p.verifierNotes ?? "",
          verifiedAt: now.toISOString(),
          verifiedBy: msg.actorId,
        };

        await updateFindingState(
          tx,
          p.findingId,
          msg.tenantId,
          "closed",
          msg.actorId,
          {
            closedAt: now,
            closedBy: msg.actorId,
            verificationEvidence,
          },
        );

        findingId = p.findingId;

        // 4. Domain event: finding closed
        await enqueue(tx, {
          topic: EVENTS.findingClosed,
          eventType: EVENTS.findingClosed,
          tenantId: msg.tenantId,
          actorId: msg.actorId,
          correlationId: msg.correlationId,
          payload: {
            findingId: p.findingId,
            findingNumber: finding.findingNumber,
            inspectionId: finding.inspectionId,
            entityId: finding.inspectionId,
            closedAt: now.toISOString(),
            verifiedBy: msg.actorId,
          },
        });

        // 5. Audit event
        await enqueue(tx, {
          topic: AUDIT_TOPIC,
          eventType: AUDIT_TOPIC,
          tenantId: msg.tenantId,
          actorId: msg.actorId,
          correlationId: msg.correlationId,
          payload: {
            action: "finding.verified_resolved",
            resourceType: "finding",
            resourceId: p.findingId,
            details: {
              previousState: currentState,
              newState: "closed",
              verificationEvidenceIds: p.verificationEvidenceIds,
              verifierNotes: p.verifierNotes,
              closedAt: now.toISOString(),
            },
          },
        });
      });

      // Cache invalidation (outside transaction, best-effort)
      if (findingId) {
        await invalidateSafely(
          cache.makeKey(msg.tenantId, "finding", findingId), log,
          { tenantId: msg.tenantId, findingId }, "failed to invalidate finding cache after verify-resolved",
        );
      }
    },
  );

  // ─── findingSoftDelete (Req 9.8) ─────────────────────────────────────────
  queue.subscribe<FindingSoftDeletePayload & { tenantId: string }>(
    COMMANDS.findingSoftDelete,
    async (msg) => {
      const p = msg.payload;
      let findingId: string | undefined;

      await db.transaction(async (tx) => {
        await markProcessed(tx, msg.messageId);

        const finding = await findFindingById(msg.tenantId, p.findingId);
        if (!finding) {
          throw new NonRetryableError(`finding ${p.findingId} not found`);
        }

        const inspection = await findInspectionById(msg.tenantId, finding.inspectionId);
        if (!inspection) {
          throw new NonRetryableError(`parent inspection ${finding.inspectionId} not found`);
        }

        try {
          assertDeletionAllowed(inspection.state);
        } catch (err) {
          if (err instanceof DomainError) {
            throw new NonRetryableError(err.message);
          }
          throw err;
        }

        await softDeleteFinding(tx, p.findingId, msg.tenantId, msg.actorId);
        findingId = p.findingId;

        await enqueue(tx, {
          topic: AUDIT_TOPIC,
          eventType: AUDIT_TOPIC,
          tenantId: msg.tenantId,
          actorId: msg.actorId,
          correlationId: msg.correlationId,
          payload: {
            action: "finding.soft_deleted",
            resourceType: "finding",
            resourceId: p.findingId,
            details: {
              findingNumber: finding.findingNumber,
              inspectionId: finding.inspectionId,
              inspectionState: inspection.state,
            },
          },
        });
      });

      if (findingId) {
        await invalidateSafely(
          cache.makeKey(msg.tenantId, "finding", findingId), log,
          { tenantId: msg.tenantId, findingId }, "failed to invalidate finding cache after soft-delete",
        );
      }
    },
  );
}
