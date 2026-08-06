/**
 * outcomes module — command consumers (G18, spec §25.3).
 *
 * Every handler has the same shape, and the order is not negotiable:
 *   markProcessed(tx, msg.messageId) FIRST  — a redelivery is then a complete no-op;
 *   the guarded write;
 *   the domain event + audit event into the outbox, in the SAME transaction;
 *   cache invalidation AFTER the transaction has committed.
 *
 * Two classes of "nothing happened" are audited rather than thrown:
 *   - a guarded UPDATE that matched nothing (the row moved, is canonical, or is deleted);
 *   - a duplicate business key.
 * Throwing either would redeliver a command that can never succeed, until it dead-letters.
 * A THIRD class — the domain rules in domain.ts — is checked here as well as at the route,
 * because the route's read is a snapshot; skipping the check would trip a CHECK constraint
 * from migration 0090, and a CHECK violation rolls back the inbox row too.
 */
import type { Queue, CommandEnvelope } from "@civitasone/queue";
import { pino } from "pino";
import type { RequestContext } from "@civitasone/types";
import { db } from "../../shared/db.js";
import { cache } from "../../shared/infra.js";
import { enqueue, markProcessed } from "../../shared/outbox.js";
import { emitWithAudit } from "../../shared/route-audit.js";
import { COMMANDS, EVENTS } from "../../topics.js";
import * as repo from "./repo.js";
import { RESOURCES } from "./queries.js";
import { parseMinorUnits, propensitySignal, validateOutcome } from "./domain.js";
import type { Governance, OutcomeType, SubjectType } from "./schema.js";

const log = pino({ name: "crm-outcomes-consumer" });

const REASON_CODE_RESOURCE_TYPE = "outcome_reason_code";
const OUTCOME_RESOURCE_TYPE = "interaction_outcome";
const AUDIT_TOPIC = "audit.event.record";

function ctxOf(msg: CommandEnvelope): RequestContext {
  return {
    tenantId: msg.tenantId,
    actorId: msg.actorId,
    correlationId: msg.correlationId,
  } as RequestContext;
}

/**
 * Audit a command that changed nothing. Deliberately NOT emitWithAudit: there is no domain
 * event to publish, and telling downstream consumers something changed when it did not is
 * how a stale projection — or a double-counted propensity signal — is born.
 */
async function auditOnly(
  tx: unknown,
  msg: CommandEnvelope,
  action: string,
  resourceType: string,
  resourceId: string,
  outcome: string,
): Promise<void> {
  await enqueue(tx as Parameters<typeof enqueue>[0], {
    topic: AUDIT_TOPIC,
    eventType: AUDIT_TOPIC,
    tenantId: msg.tenantId,
    actorId: msg.actorId,
    correlationId: msg.correlationId,
    payload: { service: "crm", action, resourceType, resourceId, outcome },
  });
}

async function invalidateReasonCode(tenantId: string, id: string): Promise<void> {
  await cache.invalidate(cache.makeKey(tenantId, RESOURCES.reasonCode, id));
  await cache.invalidateResource(tenantId, RESOURCES.reasonCode);
}

interface CreateReasonCodePayload {
  id: string;
  tenantId: string;
  code: string;
  label: string;
  description: string | null;
  category: string;
  appliesTo: OutcomeType[];
  governance: Governance;
  versionNumber: number;
  active: boolean;
  ordinal: number;
}

interface UpdateReasonCodePayload {
  id: string;
  tenantId: string;
  label?: string;
  description?: string | null;
  appliesTo?: OutcomeType[];
  ordinal?: number;
  active?: boolean;
  version: number;
}

interface RecordOutcomePayload {
  id: string;
  tenantId: string;
  subjectType: SubjectType;
  subjectId: string;
  outcomeRef: string;
  outcomeType: OutcomeType;
  reasonCodeId: string | null;
  productId: string | null;
  /** Decimal STRING of minor units. */
  amountMinor: string | null;
  currency: string | null;
  followUpNextActionId: string | null;
  occurredAt: string;
}

export function registerOutcomeConsumers(queue: Queue): void {
  // ── Reason-code catalogue ────────────────────────────────────────────────────

  queue.subscribe<CreateReasonCodePayload>(COMMANDS.createOutcomeReasonCode, async (msg) => {
    const p = msg.payload;
    try {
      await db.transaction(async (tx) => {
        if (!(await markProcessed(tx, msg.messageId))) return;
        const inserted = await repo.insertReasonCode(tx, {
          id: p.id,
          tenantId: p.tenantId,
          code: p.code,
          label: p.label,
          description: p.description,
          category: p.category,
          appliesTo: p.appliesTo,
          governance: p.governance,
          versionNumber: p.versionNumber,
          active: p.active,
          ordinal: p.ordinal,
          createdBy: msg.actorId,
          updatedBy: msg.actorId,
        });
        if (!inserted) {
          // (tenant, category, code, versionNumber) already exists — an operator
          // double-click that the route's read did not see. Not an error.
          await auditOnly(tx, msg, "create", REASON_CODE_RESOURCE_TYPE, p.id, "duplicate");
          return;
        }
        await emitWithAudit(tx, ctxOf(msg), {
          eventType: EVENTS.outcomeReasonCodeCreated,
          action: "create",
          resourceType: REASON_CODE_RESOURCE_TYPE,
          resourceId: p.id,
          payload: {
            reasonCodeId: p.id,
            code: p.code,
            category: p.category,
            appliesTo: p.appliesTo,
            versionNumber: p.versionNumber,
            active: p.active,
            governance: p.governance,
          },
        });
      });
    } catch (err) {
      log.error({ err, messageId: msg.messageId, tenantId: msg.tenantId }, "createOutcomeReasonCode failed");
      throw err;
    }
    await invalidateReasonCode(msg.tenantId, p.id);
  });

  queue.subscribe<UpdateReasonCodePayload>(COMMANDS.updateOutcomeReasonCode, async (msg) => {
    const p = msg.payload;
    await db.transaction(async (tx) => {
      if (!(await markProcessed(tx, msg.messageId))) return;
      const patch = {
        ...(p.label !== undefined ? { label: p.label } : {}),
        ...(p.description !== undefined ? { description: p.description } : {}),
        ...(p.appliesTo !== undefined ? { appliesTo: p.appliesTo } : {}),
        ...(p.ordinal !== undefined ? { ordinal: p.ordinal } : {}),
        ...(p.active !== undefined ? { active: p.active } : {}),
      };
      const updated = await repo.updateReasonCodeWithVersion(
        tx, p.id, p.tenantId, p.version, patch, msg.actorId,
      );
      if (!updated) {
        await auditOnly(tx, msg, "update", REASON_CODE_RESOURCE_TYPE, p.id, "version_conflict");
        return;
      }
      await emitWithAudit(tx, ctxOf(msg), {
        eventType: EVENTS.outcomeReasonCodeUpdated,
        action: "update",
        resourceType: REASON_CODE_RESOURCE_TYPE,
        resourceId: p.id,
        payload: { reasonCodeId: p.id, changed: Object.keys(patch) },
      });
    });
    await invalidateReasonCode(msg.tenantId, p.id);
  });

  queue.subscribe<{ id: string; tenantId: string }>(COMMANDS.deleteOutcomeReasonCode, async (msg) => {
    const p = msg.payload;
    await db.transaction(async (tx) => {
      if (!(await markProcessed(tx, msg.messageId))) return;
      const deleted = await repo.softDeleteReasonCode(tx, p.id, p.tenantId, msg.actorId);
      if (!deleted) {
        await auditOnly(tx, msg, "delete", REASON_CODE_RESOURCE_TYPE, p.id, "not_applicable");
        return;
      }
      await emitWithAudit(tx, ctxOf(msg), {
        eventType: EVENTS.outcomeReasonCodeDeleted,
        action: "delete",
        resourceType: REASON_CODE_RESOURCE_TYPE,
        resourceId: p.id,
        payload: { reasonCodeId: p.id },
      });
    });
    await invalidateReasonCode(msg.tenantId, p.id);
  });

  // ── Interaction outcomes ────────────────────────────────────────────────────

  queue.subscribe<RecordOutcomePayload>(COMMANDS.recordInteractionOutcome, async (msg) => {
    const p = msg.payload;
    try {
      await db.transaction(async (tx) => {
        if (!(await markProcessed(tx, msg.messageId))) return;

        // Resolve the reason code on THIS transaction: the catalogue may have moved
        // (retired, re-scoped) between the route accepting and this command landing.
        const reasonCode = p.reasonCodeId === null
          ? null
          : await repo.findReasonCodeByIdTx(tx, p.reasonCodeId, p.tenantId);
        if (p.reasonCodeId !== null && reasonCode === null) {
          await auditOnly(tx, msg, "record", OUTCOME_RESOURCE_TYPE, p.id, "reason_code_not_found");
          return;
        }

        const violations = validateOutcome({
          outcomeType: p.outcomeType,
          reasonCode: reasonCode === null
            ? null
            : { code: reasonCode.code, active: reasonCode.active, appliesTo: reasonCode.appliesTo },
          productId: p.productId,
          amountMinor: p.amountMinor,
          currency: p.currency,
          followUpNextActionId: p.followUpNextActionId,
        });
        if (violations.length > 0) {
          await auditOnly(tx, msg, "record", OUTCOME_RESOURCE_TYPE, p.id, `invalid:${violations[0]?.code ?? ""}`);
          return;
        }

        const amountMinor = p.amountMinor === null ? null : parseMinorUnits(p.amountMinor);
        const occurredAt = new Date(p.occurredAt);

        const inserted = await repo.insertOutcome(tx, {
          id: p.id,
          tenantId: p.tenantId,
          subjectType: p.subjectType,
          subjectId: p.subjectId,
          outcomeRef: p.outcomeRef,
          outcomeType: p.outcomeType,
          reasonCodeId: p.reasonCodeId,
          productId: p.productId,
          amountMinor,
          currency: p.currency,
          followUpNextActionId: p.followUpNextActionId,
          occurredAt,
          createdBy: msg.actorId,
          updatedBy: msg.actorId,
        });
        if (!inserted) {
          // The same outcomeRef on the same subject is ALREADY captured. Emitting again
          // would double-count the outcome in the propensity feed, which is exactly the
          // failure this guard exists to prevent.
          await auditOnly(tx, msg, "record", OUTCOME_RESOURCE_TYPE, p.id, "duplicate");
          return;
        }

        await emitWithAudit(tx, ctxOf(msg), {
          eventType: EVENTS.interactionOutcomeRecorded,
          action: "record",
          resourceType: OUTCOME_RESOURCE_TYPE,
          resourceId: p.id,
          payload: {
            outcomeId: p.id,
            tenantId: p.tenantId,
            subjectType: p.subjectType,
            subjectId: p.subjectId,
            outcomeRef: p.outcomeRef,
            outcomeType: p.outcomeType,
            reasonCode: reasonCode?.code ?? null,
            reasonCodeId: p.reasonCodeId,
            reasonCodeCategory: reasonCode?.category ?? null,
            productId: p.productId,
            // MONEY on the wire is a decimal STRING of minor units, never a JSON number.
            amountMinor: amountMinor === null ? null : amountMinor.toString(),
            currency: p.currency,
            followUpNextActionId: p.followUpNextActionId,
            propensitySignal: propensitySignal(p.outcomeType),
            occurredAt: occurredAt.toISOString(),
          },
        });
      });
    } catch (err) {
      log.error({ err, messageId: msg.messageId, tenantId: msg.tenantId }, "recordInteractionOutcome failed");
      throw err;
    }
    await cache.invalidate(cache.makeKey(msg.tenantId, RESOURCES.outcome, p.id));
    await cache.invalidateResource(msg.tenantId, RESOURCES.outcome);
  });
}
