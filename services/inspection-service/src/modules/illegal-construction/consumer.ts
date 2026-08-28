/**
 * inspection-service: Illegal Construction module — command consumers.
 *
 * This file did not exist at all before this fix — same defect as the
 * sibling encroachment module fixed in this same PR: commands.ts publishes
 * 6 commands, all reachable from real HTTP routes in routes.ts (also never
 * registered in app.ts), but nothing ever subscribed to any of them and
 * worker.ts never imported a registration function for this module either.
 * Every illegal-construction case report, inspection, violation
 * confirmation, enforcement action, and regularization submitted through
 * the API was accepted with a 202 and then silently discarded.
 *
 * Same CQRS consumer contract as every other module in this service (see
 * e.g. enforcement/consumer.ts, and encroachment/consumer.ts fixed
 * alongside this file):
 *   1. markProcessed(tx, msg.messageId) — idempotency guard
 *   2. Business write inside the same transaction
 *   3. Outbox: audit event (same transaction — atomicity)
 *   4. Cache invalidation (outside transaction, best-effort)
 *
 * _Requirements: BRD 5.20 ILBLD-001..004_
 */
import { pino } from "pino";
import type { Queue } from "@civitasone/queue";
import { NonRetryableError } from "@civitasone/queue";
import { db } from "../../shared/db.js";
import { enqueue, markProcessed } from "../../shared/outbox.js";
import { cache } from "../../shared/infra.js";
import { COMMANDS } from "../../topics.js";
import {
  assertValidCaseTransition,
  validateViolationChecklist,
  canRegularize,
  DomainError,
  type CaseState,
  type ViolationType,
} from "./domain.js";
import {
  insertCase,
  updateCase,
  findCaseById,
  nextCaseNumber,
  insertAction,
  updateAction,
  findActionById,
  nextActionNumber,
} from "./repo.js";
import type {
  CreateCasePayload,
  InspectCasePayload,
  ConfirmViolationPayload,
  IssueActionPayload,
  EnforceActionPayload,
  RegularizeCasePayload,
} from "./commands.js";

const log = pino({ name: "illegal-construction-consumer" });

const AUDIT_TOPIC = "audit.event.record";

function toDomainError(err: unknown): never {
  if (err instanceof DomainError) throw new NonRetryableError(err.message);
  throw err as Error;
}

// actionType -> the case status it drives the case to, when the case
// reaches that decision point. Only "fine" has no corresponding case
// state (a fine can be levied alongside any other action without itself
// changing the case's overall status) — see the note on
// illegalConstructionActionIssue below for why this handler is what
// actually advances the case through notice_issued/hearing_done too.
const ACTION_TYPE_TO_CASE_STATE: Partial<Record<string, CaseState>> = {
  stop_work_notice: "stop_work_ordered",
  sealing_order: "sealed",
  demolition_order: "demolition_ordered",
  regularization_order: "regularized",
};

export function registerIllegalConstructionConsumers(queue: Queue): void {
  // ─── illegalConstructionCaseCreate ────────────────────────────────────────
  queue.subscribe<CreateCasePayload & { tenantId: string }>(
    COMMANDS.illegalConstructionCaseCreate,
    async (msg) => {
      const p = msg.payload;
      let caseId: string | undefined;

      await db.transaction(async (tx) => {
        if (!(await markProcessed(tx, msg.messageId))) return;

        const record = await insertCase(tx, {
          tenantId: msg.tenantId,
          caseNumber: await nextCaseNumber(tx),
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
        caseId = record.id;

        await enqueue(tx, {
          topic: AUDIT_TOPIC, eventType: AUDIT_TOPIC,
          tenantId: msg.tenantId, actorId: msg.actorId, correlationId: msg.correlationId,
          payload: {
            action: "illegal_construction_case.reported", resourceType: "illegal_construction_case",
            resourceId: record.id,
            details: { caseNumber: record.caseNumber, violationType: p.violationType },
          },
        });
      });

      if (caseId) {
        try { await cache.invalidate(cache.makeKey(msg.tenantId, "illegal_construction_case", caseId)); }
        catch (err) { log.warn({ err, event: "cache_invalidate_failed" }, "cache invalidation failed"); }
      }
    },
  );

  // ─── illegalConstructionInspect ───────────────────────────────────────────
  queue.subscribe<InspectCasePayload & { tenantId: string }>(
    COMMANDS.illegalConstructionInspect,
    async (msg) => {
      const p = msg.payload;

      await db.transaction(async (tx) => {
        if (!(await markProcessed(tx, msg.messageId))) return;

        const record = await findCaseById(msg.tenantId, p.caseId);
        if (!record) throw new NonRetryableError(`Illegal construction case not found: ${p.caseId}`);
        try {
          assertValidCaseTransition(record.status as CaseState, "inspected");
          if (p.violationChecklist !== undefined) validateViolationChecklist(p.violationChecklist);
        } catch (err) { toDomainError(err); }

        await updateCase(tx, p.caseId, msg.tenantId, {
          status: "inspected",
          inspectedBy: msg.actorId,
          inspectedAt: new Date(),
          inspectionFindings: p.inspectionFindings,
          violationChecklist: p.violationChecklist ?? null,
          updatedBy: msg.actorId,
        }, record.version);

        await enqueue(tx, {
          topic: AUDIT_TOPIC, eventType: AUDIT_TOPIC,
          tenantId: msg.tenantId, actorId: msg.actorId, correlationId: msg.correlationId,
          payload: {
            action: "illegal_construction_case.inspected", resourceType: "illegal_construction_case",
            resourceId: p.caseId, details: {},
          },
        });
      });

      try { await cache.invalidate(cache.makeKey(msg.tenantId, "illegal_construction_case", p.caseId)); }
      catch (err) { log.warn({ err, event: "cache_invalidate_failed" }, "cache invalidation failed"); }
    },
  );

  // ─── illegalConstructionConfirm ───────────────────────────────────────────
  queue.subscribe<ConfirmViolationPayload & { tenantId: string }>(
    COMMANDS.illegalConstructionConfirm,
    async (msg) => {
      const p = msg.payload;

      await db.transaction(async (tx) => {
        if (!(await markProcessed(tx, msg.messageId))) return;

        const record = await findCaseById(msg.tenantId, p.caseId);
        if (!record) throw new NonRetryableError(`Illegal construction case not found: ${p.caseId}`);
        try {
          assertValidCaseTransition(record.status as CaseState, "violation_confirmed");
        } catch (err) { toDomainError(err); }

        await updateCase(tx, p.caseId, msg.tenantId, {
          status: "violation_confirmed", updatedBy: msg.actorId,
        }, record.version);

        await enqueue(tx, {
          topic: AUDIT_TOPIC, eventType: AUDIT_TOPIC,
          tenantId: msg.tenantId, actorId: msg.actorId, correlationId: msg.correlationId,
          payload: {
            action: "illegal_construction_case.violation_confirmed", resourceType: "illegal_construction_case",
            resourceId: p.caseId, details: {},
          },
        });
      });

      try { await cache.invalidate(cache.makeKey(msg.tenantId, "illegal_construction_case", p.caseId)); }
      catch (err) { log.warn({ err, event: "cache_invalidate_failed" }, "cache invalidation failed"); }
    },
  );

  // ─── illegalConstructionActionIssue ───────────────────────────────────────
  // The state machine has two states, notice_issued and hearing_done,
  // between violation_confirmed and the four decision states this action
  // can drive to (stop_work_ordered/sealed/demolition_ordered/regularized)
  // — but no command anywhere in commands.ts ever produces either
  // intermediate state (no "issue notice" or "record hearing" action
  // exists in the built API surface, unlike encroachment's parallel
  // notice/hearing sub-workflow, which does have those steps). "violation_
  // confirmed" is therefore the only state a real case is ever in when this
  // handler runs, so that is the one state exempted from the strict
  // transition check below (a first review round caught this exempting
  // notice_issued/hearing_done instead — the two states nothing can ever
  // reach — which made 3 of the 4 status-changing action types throw
  // INVALID_TRANSITION on every real call). "fine" is the one actionType
  // with no corresponding case state (a fine can be levied without
  // changing the case's overall status) so it records the action without
  // touching case.status or needing any transition check at all.
  queue.subscribe<IssueActionPayload & { tenantId: string }>(
    COMMANDS.illegalConstructionActionIssue,
    async (msg) => {
      const p = msg.payload;
      let actionId: string | undefined;

      await db.transaction(async (tx) => {
        if (!(await markProcessed(tx, msg.messageId))) return;

        const record = await findCaseById(msg.tenantId, p.caseId);
        if (!record) throw new NonRetryableError(`Illegal construction case not found: ${p.caseId}`);

        const targetState = ACTION_TYPE_TO_CASE_STATE[p.actionType];
        if (targetState) {
          if (p.actionType === "regularization_order") {
            // canRegularize checks both the transition AND the
            // violation-type eligibility rule (fsi_exceeded/no_permit/
            // unauthorized_floor can never be regularized, regardless of
            // state) — assertValidCaseTransition alone does not, and a
            // second review round caught that this path let a
            // regularization_order action regularize an ineligible case
            // through a weaker check than illegalConstructionRegularize
            // enforces for the identical state change.
            if (!canRegularize(record.status as CaseState, record.violationType as ViolationType)) {
              throw new NonRetryableError(
                `Case ${p.caseId} is not eligible for regularization (status "${record.status}", violation type "${record.violationType}")`,
              );
            }
          } else if (record.status !== "violation_confirmed") {
            try {
              assertValidCaseTransition(record.status as CaseState, targetState);
            } catch (err) { toDomainError(err); }
          }
        }

        let fineAmountMinor: bigint | null = null;
        if (p.fineAmountMinor !== undefined) {
          try {
            fineAmountMinor = BigInt(p.fineAmountMinor);
          } catch {
            // routes.ts validates fineAmountMinor as z.string().optional()
            // only — no numeric-format check — so a value like "25000.50"
            // or "1e5" reaches here and BigInt() throws a plain
            // SyntaxError. Convert to NonRetryableError explicitly:
            // otherwise this is redelivered up to maxReceiveCount before
            // dead-lettering instead of failing fast, for an input that
            // can never succeed no matter how many times it's retried.
            throw new NonRetryableError(`fineAmountMinor is not a valid integer string: "${p.fineAmountMinor}"`);
          }
        }

        const action = await insertAction(tx, {
          tenantId: msg.tenantId,
          caseId: p.caseId,
          actionType: p.actionType,
          actionNumber: await nextActionNumber(tx),
          issuedBy: msg.actorId,
          status: "issued",
          details: p.details ?? null,
          fineAmountMinor,
          createdBy: msg.actorId,
          updatedBy: msg.actorId,
        });
        actionId = action.id;

        if (targetState) {
          await updateCase(tx, p.caseId, msg.tenantId, {
            status: targetState, updatedBy: msg.actorId,
          }, record.version);
        }

        await enqueue(tx, {
          topic: AUDIT_TOPIC, eventType: AUDIT_TOPIC,
          tenantId: msg.tenantId, actorId: msg.actorId, correlationId: msg.correlationId,
          payload: {
            action: "illegal_construction_action.issued", resourceType: "illegal_construction_action",
            resourceId: action.id,
            details: { caseId: p.caseId, actionType: p.actionType, actionNumber: action.actionNumber },
          },
        });
      });

      const invalidations = [cache.invalidate(cache.makeKey(msg.tenantId, "illegal_construction_case", p.caseId))];
      if (actionId) invalidations.push(cache.invalidate(cache.makeKey(msg.tenantId, "illegal_construction_action", actionId)));
      try { await Promise.all(invalidations); }
      catch (err) { log.warn({ err, event: "cache_invalidate_failed" }, "cache invalidation failed"); }
    },
  );

  // ─── illegalConstructionActionEnforce ─────────────────────────────────────
  queue.subscribe<EnforceActionPayload & { tenantId: string }>(
    COMMANDS.illegalConstructionActionEnforce,
    async (msg) => {
      const p = msg.payload;
      let caseId: string | undefined;

      await db.transaction(async (tx) => {
        if (!(await markProcessed(tx, msg.messageId))) return;

        const action = await findActionById(msg.tenantId, p.actionId);
        if (!action) throw new NonRetryableError(`Illegal construction action not found: ${p.actionId}`);
        if (action.status !== "issued") {
          throw new NonRetryableError(`Action ${p.actionId} is not in "issued" state (currently "${action.status}")`);
        }

        await updateAction(tx, p.actionId, msg.tenantId, {
          status: "enforced",
          enforcedAt: new Date(),
          updatedBy: msg.actorId,
        }, action.version);

        // A demolition_order being enforced means the structure was actually
        // demolished; every other action type is enforced without a further
        // case-level state change (a stop-work/sealing/fine notice remains
        // "issued -> enforced" as an action-level fact; the case stays in the
        // decision state issueAction already moved it to).
        if (action.actionType === "demolition_order") {
          const record = await findCaseById(msg.tenantId, action.caseId);
          if (record) {
            caseId = record.id;
            try {
              assertValidCaseTransition(record.status as CaseState, "demolished");
              await updateCase(tx, action.caseId, msg.tenantId, {
                status: "demolished", updatedBy: msg.actorId,
              }, record.version);
            } catch (err) {
              if (err instanceof DomainError) {
                log.warn({ err, caseId: action.caseId, event: "case_transition_skipped" },
                  "demolition enforced but case was not in demolition_ordered — case status left unchanged");
              } else {
                throw err;
              }
            }
          }
        }

        await enqueue(tx, {
          topic: AUDIT_TOPIC, eventType: AUDIT_TOPIC,
          tenantId: msg.tenantId, actorId: msg.actorId, correlationId: msg.correlationId,
          payload: {
            action: "illegal_construction_action.enforced", resourceType: "illegal_construction_action",
            resourceId: p.actionId, details: { actionType: action.actionType },
          },
        });
      });

      // caseId is only set on the demolition_order path, which is the only
      // one that can have written a new case status above — a prior review
      // round caught this only ever invalidating the action key, leaving a
      // cached case read stale for up to the TTL after a real demolition.
      const invalidations = [cache.invalidate(cache.makeKey(msg.tenantId, "illegal_construction_action", p.actionId))];
      if (caseId) invalidations.push(cache.invalidate(cache.makeKey(msg.tenantId, "illegal_construction_case", caseId)));
      try { await Promise.all(invalidations); }
      catch (err) { log.warn({ err, event: "cache_invalidate_failed" }, "cache invalidation failed"); }
    },
  );

  // ─── illegalConstructionRegularize ────────────────────────────────────────
  queue.subscribe<RegularizeCasePayload & { tenantId: string }>(
    COMMANDS.illegalConstructionRegularize,
    async (msg) => {
      const p = msg.payload;

      await db.transaction(async (tx) => {
        if (!(await markProcessed(tx, msg.messageId))) return;

        const record = await findCaseById(msg.tenantId, p.caseId);
        if (!record) throw new NonRetryableError(`Illegal construction case not found: ${p.caseId}`);

        // canRegularize checks both the state-machine transition AND the
        // violation-type eligibility rule (fsi_exceeded/no_permit/
        // unauthorized_floor can never be regularized, regardless of
        // state) — stricter and more specific than
        // assertValidCaseTransition alone, so used directly here.
        if (!canRegularize(record.status as CaseState, record.violationType as ViolationType)) {
          throw new NonRetryableError(
            `Case ${p.caseId} is not eligible for regularization (status "${record.status}", violation type "${record.violationType}")`,
          );
        }

        await updateCase(tx, p.caseId, msg.tenantId, {
          status: "regularized",
          regularizationDetails: p.regularizationDetails,
          updatedBy: msg.actorId,
        }, record.version);

        await enqueue(tx, {
          topic: AUDIT_TOPIC, eventType: AUDIT_TOPIC,
          tenantId: msg.tenantId, actorId: msg.actorId, correlationId: msg.correlationId,
          payload: {
            action: "illegal_construction_case.regularized", resourceType: "illegal_construction_case",
            resourceId: p.caseId, details: {},
          },
        });
      });

      try { await cache.invalidate(cache.makeKey(msg.tenantId, "illegal_construction_case", p.caseId)); }
      catch (err) { log.warn({ err, event: "cache_invalidate_failed" }, "cache invalidation failed"); }
    },
  );
}
