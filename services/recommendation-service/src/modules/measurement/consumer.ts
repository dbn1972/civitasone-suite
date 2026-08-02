/**
 * measurement/consumer.ts — XS-003 handler for recommendation.attribution.record.
 *
 * Two things this handler must get right:
 *
 *  1. `markProcessed(tx, msg.messageId)` is the FIRST statement in the transaction.
 *     A redelivery is then a no-op instead of a second attributed outcome, which
 *     would inflate the numerator of every attach-rate and uplift figure derived
 *     from it.
 *  2. The DB work is wrapped in `runWithTenant(msg.tenantId, ...)`. A consumer runs
 *     outside an HTTP request, so nothing has set the `app.tenant_id` GUC that the
 *     RLS policies read, and these tables are FORCE ROW LEVEL SECURITY — without
 *     the wrapper the insert is refused by the policy rather than silently
 *     cross-tenant. `db` from shared/db.js is GUC-wrapped and takes the tenant id
 *     from the AsyncLocalStorage that runWithTenant populates.
 *
 * The HTTP route writes nothing; this is the only writer of an attribution row.
 */
import type { CommandEnvelope } from "@civitasone/queue";
import { runWithTenant } from "@civitasone/db";
import { db } from "../../shared/db.js";
import { enqueue, markProcessed } from "../../shared/outbox.js";
import { writeAudit } from "../../shared/audit.js";
import { cache } from "../../shared/infra.js";
import { EVENTS } from "../../topics.js";
import * as repo from "./repo.js";
import type { AttributionModel, Cohort } from "./schema.js";

export interface RecordAttributionPayload {
  attributionId: string;
  campaignKey: string;
  subjectId: string;
  /** Null for a control-cohort conversion — a holdout is never served anything. */
  recommendationId: string | null;
  outcomeType: string;
  outcomeRef: string;
  productId: string | null;
  /** MONEY — minor units as a STRING on the wire; converted to bigint here. */
  amountMinor: string;
  currency: string;
  cohort: Cohort;
  attributionModel: AttributionModel;
  occurredAt: string;
}

/** Parse minor units without ever going through a float. */
function toMinor(value: string): bigint {
  const trimmed = value.trim();
  if (!/^-?\d+$/.test(trimmed)) return 0n;
  return BigInt(trimmed);
}

export async function handleRecordAttribution(
  msg: CommandEnvelope<RecordAttributionPayload>,
): Promise<void> {
  const p = msg.payload;

  await runWithTenant(msg.tenantId, async () => {
    await db.transaction(async (tx) => {
      // Idempotency gate — must be the first statement in the transaction.
      const fresh = await markProcessed(tx, msg.messageId);
      if (!fresh) return;

      await repo.insertAttribution(tx, {
        id: p.attributionId,
        tenantId: msg.tenantId,
        campaignKey: p.campaignKey,
        subjectId: p.subjectId,
        recommendationId: p.recommendationId,
        outcomeType: p.outcomeType,
        outcomeRef: p.outcomeRef,
        productId: p.productId,
        attributedAmountMinor: toMinor(p.amountMinor),
        currency: p.currency,
        cohort: p.cohort,
        attributionModel: p.attributionModel,
        occurredAt: new Date(p.occurredAt),
        createdBy: msg.actorId,
        updatedBy: msg.actorId,
      });

      await enqueue(tx, {
        topic: EVENTS.outcomeAttributed,
        eventType: EVENTS.outcomeAttributed,
        tenantId: msg.tenantId,
        actorId: msg.actorId,
        correlationId: msg.correlationId,
        payload: {
          attributionId: p.attributionId,
          campaignKey: p.campaignKey,
          recommendationId: p.recommendationId,
          cohort: p.cohort,
          attributionModel: p.attributionModel,
          // String, matching the bigint column exactly.
          attributedAmountMinor: p.amountMinor,
          currency: p.currency,
        },
      });
    });
  });

  // Outside the transaction: a missed invalidation self-heals via the bounded TTL.
  await cache.invalidate(cache.makeKey(msg.tenantId, "cross-sell-metrics", p.campaignKey));
}


export interface AssignExposurePayload {
  exposureId: string;
  campaignKey: string;
  subjectId: string;
  cohort: Cohort;
  assignedAt: string;
}

export async function handleAssignExposure(
  msg: CommandEnvelope<AssignExposurePayload>,
): Promise<void> {
  const p = msg.payload;
  await runWithTenant(msg.tenantId, async () => {
    await db.transaction(async (tx) => {
      const fresh = await markProcessed(tx, msg.messageId);
      if (!fresh) return;
      await repo.insertExposure(tx, {
        id: p.exposureId,
        tenantId: msg.tenantId,
        campaignKey: p.campaignKey,
        subjectId: p.subjectId,
        cohort: p.cohort,
        assignedAt: new Date(p.assignedAt),
        createdBy: msg.actorId,
        updatedBy: msg.actorId,
      });
      await enqueue(tx, {
        topic: EVENTS.cohortAssigned,
        eventType: EVENTS.cohortAssigned,
        tenantId: msg.tenantId,
        actorId: msg.actorId,
        correlationId: msg.correlationId,
        payload: {
          exposureId: p.exposureId,
          campaignKey: p.campaignKey,
          cohort: p.cohort,
        },
      });
      await writeAudit(
        tx,
        { tenantId: msg.tenantId, actorId: msg.actorId, correlationId: msg.correlationId },
        { action: "exposure.assign", resourceType: "measurement_exposure", resourceId: p.exposureId },
      );
    });
  });
  await cache.invalidate(cache.makeKey(msg.tenantId, "cross-sell-metrics", p.campaignKey));
}
