/**
 * Programme command consumers (G12 — Spec §25.7, Journey J6).
 *
 * Every handler follows the same shape, in this order, inside ONE transaction:
 *   1. markProcessed(tx, msg.messageId) — FIRST statement, always. A redelivery returns
 *      early and writes nothing; because it shares the transaction, a rolled-back write
 *      also rolls back the mark, so a genuine failure is still retried.
 *   2. the guarded write.
 *   3. the domain event + audit event, enqueued into the outbox in the same transaction so
 *      the trail cannot commit without the row (or the row without the trail).
 * and then, AFTER the transaction commits, cache invalidation.
 *
 * The guards are re-checked here even though the routes already checked them. The route's
 * read is a snapshot: between its 202 and this write, the programme may have been closed,
 * amended or renumbered. A guarded UPDATE that matches nothing emits an audit record with
 * a `rejected_*` outcome rather than disappearing, because "the write was dropped because
 * the programme is already closed" is the line someone needs to find six months later.
 */
import type { Queue, CommandEnvelope } from "@civitasone/queue";
import { pino } from "pino";
import { db } from "../../shared/db.js";
import { markProcessed } from "../../shared/outbox.js";
import { emitWithAudit } from "../../shared/route-audit.js";
import { COMMANDS, EVENTS } from "../../topics.js";
import * as repo from "./repo.js";
import { RESOURCE, invalidateProgramme } from "./queries.js";
import { invalidateDeal } from "../deals/queries.js";
import {
  canTransition,
  isProgrammeStatus,
  normaliseCoverageScope,
  normaliseProgrammeCode,
  type MetricKind,
} from "./domain.js";
import type { CoverageScope } from "./schema.js";

const log = pino({ name: "crm-programmes-consumer" });

const METRIC_RESOURCE_TYPE = "programme_metric";

type CtxLike = Parameters<typeof emitWithAudit>[1];

function ctxOf(msg: { tenantId: string; actorId: string; correlationId: string }): CtxLike {
  return {
    tenantId: msg.tenantId,
    actorId: msg.actorId,
    correlationId: msg.correlationId,
  } as CtxLike;
}

interface CreatePayload {
  id: string;
  tenantId: string;
  programmeCode: string;
  name: string;
  description: string | null;
  accountId: string;
  contractId: string | null;
  productLine: string;
  status: string;
  startDate: string | null;
  endDate: string | null;
  sponsoringDepartment: string | null;
  coverageScope: CoverageScope;
}

interface UpdatePayload {
  id: string;
  tenantId: string;
  changed: {
    name?: string;
    description?: string | null;
    contractId?: string | null;
    productLine?: string;
    startDate?: string | null;
    endDate?: string | null;
    sponsoringDepartment?: string | null;
    coverageScope?: CoverageScope;
  };
  version: number;
}

interface StatusPayload {
  id: string;
  tenantId: string;
  fromStatus: string;
  toStatus: string;
  reason: string | null;
  version: number;
}

interface MetricPayload {
  id: string;
  tenantId: string;
  programmeId: string;
  periodStart: string;
  periodEnd: string;
  metricKey: string;
  metricKind: MetricKind;
  valueMinor: string | null;
  currency: string | null;
  valueNumeric: string | null;
}

interface LinkDealPayload {
  id: string;
  tenantId: string;
  dealId: string;
  dealVersion: number;
}

export function registerProgrammeConsumers(queue: Queue): void {
  queue.subscribe(COMMANDS.createProgramme, async (msg) => {
    const p = msg.payload as CreatePayload;
    try {
      await db.transaction(async (tx) => {
        if (!(await markProcessed(tx, msg.messageId))) return;
        const created = await repo.insertProgramme(tx, {
          id: p.id,
          tenantId: p.tenantId,
          // Re-normalised: the route already did it, but a command could also arrive from
          // an internal producer that did not.
          programmeCode: normaliseProgrammeCode(p.programmeCode),
          name: p.name,
          description: p.description,
          accountId: p.accountId,
          contractId: p.contractId,
          productLine: p.productLine,
          status: p.status,
          startDate: p.startDate,
          endDate: p.endDate,
          sponsoringDepartment: p.sponsoringDepartment,
          coverageScope: normaliseCoverageScope(p.coverageScope),
          actorId: msg.actorId,
        });

        if (!created) {
          // The code is already registered in this tenant. Not an error — two operators
          // racing to register the same programme should converge, not 500.
          await emitWithAudit(tx, ctxOf(msg), {
            eventType: EVENTS.programmeCreated,
            action: "create",
            resourceType: RESOURCE,
            resourceId: p.id,
            payload: { programmeId: p.id, programmeCode: p.programmeCode, rejected: true },
            outcome: "rejected_duplicate_code",
          });
          return;
        }

        await emitWithAudit(tx, ctxOf(msg), {
          eventType: EVENTS.programmeCreated,
          action: "create",
          resourceType: RESOURCE,
          resourceId: p.id,
          payload: {
            programmeId: p.id,
            programmeCode: p.programmeCode,
            accountId: p.accountId,
            productLine: p.productLine,
            status: p.status,
          },
        });
      });
    } catch (err) {
      log.error({ err, messageId: msg.messageId }, "createProgramme failed");
      throw err;
    }
    await invalidateProgramme(msg.tenantId, p.id);
  });

  queue.subscribe(COMMANDS.updateProgramme, async (msg) => {
    const p = msg.payload as UpdatePayload;
    try {
      await db.transaction(async (tx) => {
        if (!(await markProcessed(tx, msg.messageId))) return;
        const patch = {
          ...(p.changed.name !== undefined ? { name: p.changed.name } : {}),
          ...(p.changed.description !== undefined ? { description: p.changed.description } : {}),
          ...(p.changed.contractId !== undefined ? { contractId: p.changed.contractId } : {}),
          ...(p.changed.productLine !== undefined ? { productLine: p.changed.productLine } : {}),
          ...(p.changed.startDate !== undefined ? { startDate: p.changed.startDate } : {}),
          ...(p.changed.endDate !== undefined ? { endDate: p.changed.endDate } : {}),
          ...(p.changed.sponsoringDepartment !== undefined
            ? { sponsoringDepartment: p.changed.sponsoringDepartment }
            : {}),
          ...(p.changed.coverageScope !== undefined
            ? { coverageScope: normaliseCoverageScope(p.changed.coverageScope) }
            : {}),
        };
        const applied = await repo.updateWithVersion(
          tx,
          p.id,
          p.tenantId,
          p.version,
          patch,
          msg.actorId,
        );
        if (!applied) {
          await emitWithAudit(tx, ctxOf(msg), {
            eventType: EVENTS.programmeUpdated,
            action: "update",
            resourceType: RESOURCE,
            resourceId: p.id,
            payload: { programmeId: p.id, rejected: true },
            outcome: "rejected_stale_version",
          });
          return;
        }
        await emitWithAudit(tx, ctxOf(msg), {
          eventType: EVENTS.programmeUpdated,
          action: "update",
          resourceType: RESOURCE,
          resourceId: p.id,
          // Field NAMES only. The values include a sponsoring department and coverage
          // list, which belong in the row, not broadcast to every consumer.
          payload: { programmeId: p.id, changed: Object.keys(patch) },
        });
      });
    } catch (err) {
      log.error({ err, messageId: msg.messageId }, "updateProgramme failed");
      throw err;
    }
    await invalidateProgramme(msg.tenantId, p.id);
  });

  queue.subscribe(COMMANDS.changeProgrammeStatus, async (msg) => {
    const p = msg.payload as StatusPayload;
    try {
      await db.transaction(async (tx) => {
        if (!(await markProcessed(tx, msg.messageId))) return;

        // The lifecycle is re-validated here, not merely the version: a command that was
        // legal against the snapshot the route read can be illegal by now.
        const legal =
          isProgrammeStatus(p.fromStatus) &&
          isProgrammeStatus(p.toStatus) &&
          canTransition(p.fromStatus, p.toStatus);

        const applied =
          legal &&
          (await repo.changeStatusWithVersion(
            tx,
            p.id,
            p.tenantId,
            p.fromStatus,
            p.toStatus,
            p.version,
            msg.actorId,
          ));

        if (!applied) {
          await emitWithAudit(tx, ctxOf(msg), {
            eventType: EVENTS.programmeStatusChanged,
            action: "change_status",
            resourceType: RESOURCE,
            resourceId: p.id,
            payload: { programmeId: p.id, toStatus: p.toStatus, rejected: true },
            outcome: legal ? "rejected_stale_state" : "rejected_illegal_transition",
          });
          return;
        }

        await emitWithAudit(tx, ctxOf(msg), {
          eventType: EVENTS.programmeStatusChanged,
          action: "change_status",
          resourceType: RESOURCE,
          resourceId: p.id,
          payload: { programmeId: p.id, fromStatus: p.fromStatus, toStatus: p.toStatus },
        });
      });
    } catch (err) {
      log.error({ err, messageId: msg.messageId }, "changeProgrammeStatus failed");
      throw err;
    }
    await invalidateProgramme(msg.tenantId, p.id);
  });

  queue.subscribe(COMMANDS.recordProgrammeMetric, async (msg) => {
    const p = msg.payload as MetricPayload;
    try {
      await db.transaction(async (tx) => {
        if (!(await markProcessed(tx, msg.messageId))) return;
        const result = await repo.upsertMetric(tx, {
          id: p.id,
          tenantId: p.tenantId,
          programmeId: p.programmeId,
          periodStart: p.periodStart,
          periodEnd: p.periodEnd,
          metricKey: p.metricKey,
          metricKind: p.metricKind,
          // Parsed back to BigInt here, not in the payload: the wire form is a string
          // precisely so nothing between the route and this line can round it.
          valueMinor: p.valueMinor === null ? null : BigInt(p.valueMinor),
          currency: p.currency,
          valueNumeric: p.valueNumeric,
          actorId: msg.actorId,
        });
        await emitWithAudit(tx, ctxOf(msg), {
          eventType: EVENTS.programmeMetricRecorded,
          action: "record_metric",
          resourceType: METRIC_RESOURCE_TYPE,
          resourceId: result.id,
          payload: {
            programmeId: p.programmeId,
            metricId: result.id,
            periodStart: p.periodStart,
            periodEnd: p.periodEnd,
            metricKey: p.metricKey,
            metricKind: p.metricKind,
            valueMinor: p.valueMinor,
            currency: p.currency,
            valueNumeric: p.valueNumeric,
            outcome: result.created ? "created" : "updated",
          },
        });
      });
    } catch (err) {
      log.error({ err, messageId: msg.messageId }, "recordProgrammeMetric failed");
      throw err;
    }
    await invalidateProgramme(msg.tenantId, p.programmeId);
  });

  queue.subscribe(COMMANDS.linkDealToProgramme, async (msg) => {
    const p = msg.payload as LinkDealPayload;
    try {
      await db.transaction(async (tx) => {
        if (!(await markProcessed(tx, msg.messageId))) return;
        const applied = await repo.linkDeal(
          tx,
          p.dealId,
          p.tenantId,
          p.id,
          p.dealVersion,
          msg.actorId,
        );
        if (!applied) {
          await emitWithAudit(tx, ctxOf(msg), {
            eventType: EVENTS.programmeDealLinked,
            action: "link_deal",
            resourceType: RESOURCE,
            resourceId: p.id,
            payload: { programmeId: p.id, dealId: p.dealId, rejected: true },
            outcome: "rejected_stale_deal",
          });
          return;
        }
        await emitWithAudit(tx, ctxOf(msg), {
          eventType: EVENTS.programmeDealLinked,
          action: "link_deal",
          resourceType: RESOURCE,
          resourceId: p.id,
          payload: { programmeId: p.id, dealId: p.dealId },
        });
      });
    } catch (err) {
      log.error({ err, messageId: msg.messageId }, "linkDealToProgramme failed");
      throw err;
    }
    await invalidateProgramme(msg.tenantId, p.id);
    // The write landed in crm.deals, so the DEAL's read cache is the stale one. Without
    // this the deal read path would keep serving a pre-link snapshot for up to the TTL.
    // Swallowed with a WARN for the same reason as invalidateProgramme: the row is already
    // committed, and throwing here would redeliver a message that has nothing left to do.
    try {
      await invalidateDeal(msg.tenantId, p.dealId);
    } catch (err) {
      log.warn({ err, dealId: p.dealId }, "deal cache invalidation failed — entry will expire by TTL");
    }
  });
}
