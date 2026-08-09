/**
 * inspection-service: Illegal Construction module — command consumers.
 *
 * Each handler follows the CivitasOne CQRS consumer contract:
 *   1. markProcessed(tx, msg.messageId) — idempotency guard
 *   2. Business write inside the same transaction
 *   3. Outbox: domain event + audit event (same transaction — atomicity)
 *   4. Cache invalidation (outside transaction — best-effort)
 *
 * _Requirements: BRD 5.20 ILBLD-001..004_
 */
import { pino } from "pino";
import type { Queue } from "@civitasone/queue";
import { NonRetryableError } from "@civitasone/queue";
import { db } from "../../shared/db.js";
import { enqueue, markProcessed } from "../../shared/outbox.js";
import { cache } from "../../shared/infra.js";
import { COMMANDS, EVENTS } from "../../topics.js";
import {
  generateCaseNumber,
  generateActionNumber,
  assertValidCaseTransition,
  validateViolationChecklist,
  canRegularize,
  DomainError,
} from "./domain.js";
import type { CaseState, ViolationType } from "./domain.js";
import {
  insertCase,
  updateCase,
  findCaseById,
  insertAction,
  updateAction,
  findActionById,
} from "./repo.js";
import type {
import { tenantScoped } from "../../shared/tenant-queue.js";
  CreateCasePayload,
  InspectCasePayload,
  ConfirmViolationPayload,
  IssueActionPayload,
  EnforceActionPayload,
  RegularizeCasePayload,
} from "./commands.js";

const log = pino({ name: "illegal-construction-consumer" });

const AUDIT_TOPIC = "audit.event.record";

// ── Action type to case state mapping ────────────────────────────────────────
const ACTION_TYPE_TO_STATE: Record<string, CaseState> = {
  stop_work_notice: "stop_work_ordered",
  sealing_order: "sealed",
  demolition_order: "demolition_ordered",
};

// ── Registration ─────────────────────────────────────────────────────────────

export function registerIllegalConstructionConsumers(rawQueue: Queue): void {
  // ─── createCase ───────────────────────────────────────────────────────────
  const queue = tenantScoped(rawQueue);
  queue.subscribe<CreateCasePayload & { tenantId: string }>(
    COMMANDS.illegalConstructionCaseCreate,
    async (msg) => {
      const p = msg.payload;
      let caseId: string | undefined;

      await db.transaction(async (tx) => {
        if (!(await markProcessed(tx, msg.messageId))) return;

        const caseRow = await insertCase(tx, {
          tenantId: msg.tenantId,
          caseNumber: generateCaseNumber(),
          reportedBy: p.reportedBy,
          location: p.location,
          buildingPermitRef: p.buildingPermitRef ?? null,
          ownerName: p.ownerName,
          ownerContact: p.ownerContact ?? null,
          violationType: p.violationType,
          description: p.description,
          photos: p.photos ?? null,
          status: "reported",
          createdBy: msg.actorId,
          updatedBy: msg.actorId,
        });

        caseId = caseRow.id;

        await enqueue(tx, {
          topic: EVENTS.illegalConstructionCaseCreated,
          eventType: EVENTS.illegalConstructionCaseCreated,
          tenantId: msg.tenantId,
          actorId: msg.actorId,
          correlationId: msg.correlationId,
          payload: {
            caseId: caseRow.id,
            caseNumber: caseRow.caseNumber,
            violationType: p.violationType,
            ownerName: p.ownerName,
          },
        });

        await enqueue(tx, {
          topic: AUDIT_TOPIC,
          eventType: AUDIT_TOPIC,
          tenantId: msg.tenantId,
          actorId: msg.actorId,
          correlationId: msg.correlationId,
          payload: {
            service: "inspection",
            action: "illegal_construction_case.created",
            resourceType: "illegal_construction_case",
            resourceId: caseRow.id,
            outcome: "success",
          },
        });
      });

      if (caseId) {
        try { await cache.invalidate(cache.makeKey(msg.tenantId, "illegal_construction_case", caseId)); }
        catch (err) { log.warn({ err, event: "cache_invalidate_failed" }, "cache invalidation failed"); }
      }
    },
  );

  // ─── inspectCase ──────────────────────────────────────────────────────────
  queue.subscribe<InspectCasePayload & { tenantId: string }>(
    COMMANDS.illegalConstructionInspect,
    async (msg) => {
      const p = msg.payload;

      await db.transaction(async (tx) => {
        if (!(await markProcessed(tx, msg.messageId))) return;

        const caseRow = await findCaseById(msg.tenantId, p.caseId);
        if (!caseRow) throw new NonRetryableError(`Case not found: ${p.caseId}`);

        try {
          assertValidCaseTransition(caseRow.status as CaseState, "inspected");
          validateViolationChecklist(p.violationChecklist);
        } catch (err) {
          if (err instanceof DomainError) throw new NonRetryableError(err.message);
          throw err;
        }

        await updateCase(tx, p.caseId, msg.tenantId, {
          status: "inspected",
          inspectedBy: msg.actorId,
          inspectedAt: new Date(),
          inspectionFindings: p.inspectionFindings,
          violationChecklist: p.violationChecklist as Record<string, unknown>,
          updatedBy: msg.actorId,
        }, caseRow.version);

        await enqueue(tx, {
          topic: AUDIT_TOPIC,
          eventType: AUDIT_TOPIC,
          tenantId: msg.tenantId,
          actorId: msg.actorId,
          correlationId: msg.correlationId,
          payload: {
            service: "inspection",
            action: "illegal_construction_case.inspected",
            resourceType: "illegal_construction_case",
            resourceId: p.caseId,
            outcome: "success",
          },
        });
      });

      try { await cache.invalidate(cache.makeKey(msg.tenantId, "illegal_construction_case", p.caseId)); }
      catch (err) { log.warn({ err, event: "cache_invalidate_failed" }, "cache invalidation failed"); }
    },
  );

  // ─── confirmViolation ─────────────────────────────────────────────────────
  queue.subscribe<ConfirmViolationPayload & { tenantId: string }>(
    COMMANDS.illegalConstructionConfirm,
    async (msg) => {
      const p = msg.payload;

      await db.transaction(async (tx) => {
        if (!(await markProcessed(tx, msg.messageId))) return;

        const caseRow = await findCaseById(msg.tenantId, p.caseId);
        if (!caseRow) throw new NonRetryableError(`Case not found: ${p.caseId}`);

        try {
          assertValidCaseTransition(caseRow.status as CaseState, "violation_confirmed");
        } catch (err) {
          if (err instanceof DomainError) throw new NonRetryableError(err.message);
          throw err;
        }

        await updateCase(tx, p.caseId, msg.tenantId, {
          status: "violation_confirmed",
          updatedBy: msg.actorId,
        }, caseRow.version);

        await enqueue(tx, {
          topic: EVENTS.illegalConstructionViolationConfirmed,
          eventType: EVENTS.illegalConstructionViolationConfirmed,
          tenantId: msg.tenantId,
          actorId: msg.actorId,
          correlationId: msg.correlationId,
          payload: {
            caseId: p.caseId,
            caseNumber: caseRow.caseNumber,
            violationType: caseRow.violationType,
          },
        });

        await enqueue(tx, {
          topic: AUDIT_TOPIC,
          eventType: AUDIT_TOPIC,
          tenantId: msg.tenantId,
          actorId: msg.actorId,
          correlationId: msg.correlationId,
          payload: {
            service: "inspection",
            action: "illegal_construction_case.violation_confirmed",
            resourceType: "illegal_construction_case",
            resourceId: p.caseId,
            outcome: "success",
          },
        });
      });

      try { await cache.invalidate(cache.makeKey(msg.tenantId, "illegal_construction_case", p.caseId)); }
      catch (err) { log.warn({ err, event: "cache_invalidate_failed" }, "cache invalidation failed"); }
    },
  );

  // ─── issueAction ──────────────────────────────────────────────────────────
  queue.subscribe<IssueActionPayload & { tenantId: string }>(
    COMMANDS.illegalConstructionActionIssue,
    async (msg) => {
      const p = msg.payload;
      let actionId: string | undefined;

      await db.transaction(async (tx) => {
        if (!(await markProcessed(tx, msg.messageId))) return;

        const caseRow = await findCaseById(msg.tenantId, p.caseId);
        if (!caseRow) throw new NonRetryableError(`Case not found: ${p.caseId}`);

        const action = await insertAction(tx, {
          tenantId: msg.tenantId,
          caseId: p.caseId,
          actionType: p.actionType,
          actionNumber: generateActionNumber(),
          issuedBy: msg.actorId,
          status: "issued",
          details: p.details ?? null,
          fineAmountMinor: p.fineAmountMinor ? BigInt(p.fineAmountMinor) : null,
          createdBy: msg.actorId,
          updatedBy: msg.actorId,
        });

        actionId = action.id;

        // Transition case state based on action type
        const targetCaseState = ACTION_TYPE_TO_STATE[p.actionType];
        if (targetCaseState) {
          try {
            assertValidCaseTransition(caseRow.status as CaseState, targetCaseState);
            await updateCase(tx, p.caseId, msg.tenantId, {
              status: targetCaseState,
              updatedBy: msg.actorId,
            }, caseRow.version);
          } catch {
            // Skip if case transition not valid from current state
          }
        }

        await enqueue(tx, {
          topic: EVENTS.illegalConstructionActionIssued,
          eventType: EVENTS.illegalConstructionActionIssued,
          tenantId: msg.tenantId,
          actorId: msg.actorId,
          correlationId: msg.correlationId,
          payload: {
            actionId: action.id,
            actionNumber: action.actionNumber,
            caseId: p.caseId,
            actionType: p.actionType,
          },
        });

        await enqueue(tx, {
          topic: AUDIT_TOPIC,
          eventType: AUDIT_TOPIC,
          tenantId: msg.tenantId,
          actorId: msg.actorId,
          correlationId: msg.correlationId,
          payload: {
            service: "inspection",
            action: "illegal_construction_action.issued",
            resourceType: "illegal_construction_action",
            resourceId: action.id,
            outcome: "success",
          },
        });
      });

      if (actionId) {
        try { await cache.invalidate(cache.makeKey(msg.tenantId, "illegal_construction_action", actionId)); }
        catch (err) { log.warn({ err, event: "cache_invalidate_failed" }, "cache invalidation failed"); }
      }
    },
  );

  // ─── enforceAction ────────────────────────────────────────────────────────
  queue.subscribe<EnforceActionPayload & { tenantId: string }>(
    COMMANDS.illegalConstructionActionEnforce,
    async (msg) => {
      const p = msg.payload;

      await db.transaction(async (tx) => {
        if (!(await markProcessed(tx, msg.messageId))) return;

        const action = await findActionById(msg.tenantId, p.actionId);
        if (!action) throw new NonRetryableError(`Action not found: ${p.actionId}`);

        if (action.status !== "issued") {
          throw new NonRetryableError(
            `Cannot enforce action in status '${action.status}'; must be 'issued'`,
          );
        }

        await updateAction(tx, p.actionId, msg.tenantId, {
          status: "enforced",
          enforcedAt: new Date(),
          updatedBy: msg.actorId,
        }, action.version);

        // If demolition_order enforced, transition case to demolished
        if (action.actionType === "demolition_order") {
          const caseRow = await findCaseById(msg.tenantId, action.caseId);
          if (caseRow) {
            try {
              assertValidCaseTransition(caseRow.status as CaseState, "demolished");
              await updateCase(tx, action.caseId, msg.tenantId, {
                status: "demolished",
                updatedBy: msg.actorId,
              }, caseRow.version);
            } catch {
              // Skip if case transition not valid
            }
          }
        }

        await enqueue(tx, {
          topic: AUDIT_TOPIC,
          eventType: AUDIT_TOPIC,
          tenantId: msg.tenantId,
          actorId: msg.actorId,
          correlationId: msg.correlationId,
          payload: {
            service: "inspection",
            action: "illegal_construction_action.enforced",
            resourceType: "illegal_construction_action",
            resourceId: p.actionId,
            outcome: "success",
          },
        });
      });

      try { await cache.invalidate(cache.makeKey(msg.tenantId, "illegal_construction_action", p.actionId)); }
      catch (err) { log.warn({ err, event: "cache_invalidate_failed" }, "cache invalidation failed"); }
    },
  );

  // ─── regularizeCase ───────────────────────────────────────────────────────
  queue.subscribe<RegularizeCasePayload & { tenantId: string }>(
    COMMANDS.illegalConstructionRegularize,
    async (msg) => {
      const p = msg.payload;

      await db.transaction(async (tx) => {
        if (!(await markProcessed(tx, msg.messageId))) return;

        const caseRow = await findCaseById(msg.tenantId, p.caseId);
        if (!caseRow) throw new NonRetryableError(`Case not found: ${p.caseId}`);

        if (!canRegularize(caseRow.status as CaseState, caseRow.violationType as ViolationType)) {
          throw new NonRetryableError(
            `Case ${p.caseId} cannot be regularized from status '${caseRow.status}' with violation type '${caseRow.violationType}'`,
          );
        }

        try {
          assertValidCaseTransition(caseRow.status as CaseState, "regularized");
        } catch (err) {
          if (err instanceof DomainError) throw new NonRetryableError(err.message);
          throw err;
        }

        await updateCase(tx, p.caseId, msg.tenantId, {
          status: "regularized",
          updatedBy: msg.actorId,
        }, caseRow.version);

        await enqueue(tx, {
          topic: EVENTS.illegalConstructionRegularized,
          eventType: EVENTS.illegalConstructionRegularized,
          tenantId: msg.tenantId,
          actorId: msg.actorId,
          correlationId: msg.correlationId,
          payload: {
            caseId: p.caseId,
            caseNumber: caseRow.caseNumber,
            regularizedBy: msg.actorId,
          },
        });

        await enqueue(tx, {
          topic: AUDIT_TOPIC,
          eventType: AUDIT_TOPIC,
          tenantId: msg.tenantId,
          actorId: msg.actorId,
          correlationId: msg.correlationId,
          payload: {
            service: "inspection",
            action: "illegal_construction_case.regularized",
            resourceType: "illegal_construction_case",
            resourceId: p.caseId,
            outcome: "success",
          },
        });
      });

      try { await cache.invalidate(cache.makeKey(msg.tenantId, "illegal_construction_case", p.caseId)); }
      catch (err) { log.warn({ err, event: "cache_invalidate_failed" }, "cache invalidation failed"); }
    },
  );
}
