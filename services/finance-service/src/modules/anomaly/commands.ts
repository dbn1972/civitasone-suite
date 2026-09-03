/**
 * Anomaly Detection Commands
 *
 * Write operations for anomaly detection module (dismiss, create flag).
 *
 * Requirements: 11.5, 11.6, 11.7
 */
import { eq, and } from "drizzle-orm";
import { randomUUID } from "node:crypto";
import { db } from "../../shared/db.js";
import { enqueue } from "../../shared/outbox.js";
import { financeAnomalies } from "./schema.js";
import type { DetectedAnomaly } from "./domain.js";
import type { RequestContext } from "@civitasone/types";

const AUDIT_TOPIC = "audit.event.record";

/**
 * Dismiss an anomaly with reason. Only audit_officer or finance_admin can dismiss.
 * Sets status to "dismissed", records the reason and actor, preventing re-flagging.
 *
 * Requirements: 11.7
 */
export async function dismissAnomaly(
  ctx: RequestContext,
  anomalyId: string,
  reason: string
): Promise<{ id: string; status: string }> {
  const now = new Date();

  const result = await db.transaction(async (tx) => {
    const updated = await tx
      .update(financeAnomalies)
      .set({
        status: "dismissed",
        dismissedBy: ctx.actorId,
        dismissReason: reason,
        dismissedAt: now,
        updatedAt: now,
        updatedBy: ctx.actorId,
        version: 2,
      })
      .where(
        and(
          eq(financeAnomalies.id, anomalyId),
          eq(financeAnomalies.tenantId, ctx.tenantId)
        )
      )
      .returning({ id: financeAnomalies.id, status: financeAnomalies.status });

    if (updated.length === 0) {
      return null;
    }

    // Emit audit event for dismissal
    await enqueue(tx, {
      topic: AUDIT_TOPIC,
      eventType: AUDIT_TOPIC,
      tenantId: ctx.tenantId,
      actorId: ctx.actorId,
      correlationId: randomUUID(),
      payload: {
        service: "finance",
        action: "anomaly_dismissed",
        resourceType: "finance_anomaly",
        resourceId: anomalyId,
        outcome: "success",
        details: { reason },
      },
    });

    return updated[0]!;
  });

  return result ?? { id: anomalyId, status: "not_found" };
}

/**
 * Create an anomaly flag record for a detected anomaly.
 *
 * Requirements: 11.5, 11.6
 */
export async function createAnomalyFlag(
  tenantId: string,
  actorId: string,
  anomaly: DetectedAnomaly,
  correlationId: string
): Promise<string> {
  const id = randomUUID();

  await db.transaction(async (tx) => {
    await tx.insert(financeAnomalies).values({
      id,
      tenantId,
      transactionId: anomaly.transactionId,
      anomalyType: anomaly.anomalyType,
      severity: anomaly.severity,
      status: "open",
      zScore: anomaly.zScore?.toFixed(4) ?? null,
      factors: anomaly.factors,
      vendorId: anomaly.vendorId ?? null,
      categoryId: anomaly.categoryId ?? null,
      amountMinor: anomaly.amountPaise != null ? BigInt(anomaly.amountPaise) : null,
      correlationId,
      createdBy: actorId,
      updatedBy: actorId,
    });

    // Emit ml.prediction.anomaly_detected event
    await enqueue(tx, {
      topic: "ml.prediction.anomaly_detected",
      eventType: "ml.prediction.anomaly_detected",
      tenantId,
      actorId,
      correlationId,
      payload: {
        tenantId,
        domain: "transactions",
        entityId: anomaly.transactionId,
        anomalyType: anomaly.anomalyType,
        severity: anomaly.severity,
        factors: anomaly.factors,
        zScore: anomaly.zScore,
        timestamp: new Date().toISOString(),
        correlationId,
      },
    });
  });

  return id;
}

/**
 * Tx-scoped variant of createAnomalyFlag for use inside an existing db.transaction.
 * Accepts the outer tx instead of opening its own, so markProcessed + anomaly insert are atomic.
 */
export async function createAnomalyFlagTx(
  tx: Parameters<typeof enqueue>[0],
  tenantId: string,
  actorId: string,
  anomaly: DetectedAnomaly,
  correlationId: string,
): Promise<string> {
  const id = randomUUID();
  const txDb = tx as unknown as typeof import("../../shared/db.js").db;
  await txDb.insert(financeAnomalies).values({
    id,
    tenantId,
    transactionId: anomaly.transactionId,
    anomalyType: anomaly.anomalyType,
    severity: anomaly.severity,
    status: "open",
    zScore: anomaly.zScore?.toFixed(4) ?? null,
    factors: anomaly.factors,
    vendorId: anomaly.vendorId ?? null,
    categoryId: anomaly.categoryId ?? null,
    amountMinor: anomaly.amountPaise != null ? BigInt(anomaly.amountPaise) : null,
    correlationId,
    createdBy: actorId,
    updatedBy: actorId,
  });
  await enqueue(tx, {
    topic: "ml.prediction.anomaly_detected",
    eventType: "ml.prediction.anomaly_detected",
    tenantId,
    actorId,
    correlationId,
    payload: {
      tenantId,
      domain: "transactions",
      entityId: anomaly.transactionId,
      anomalyType: anomaly.anomalyType,
      severity: anomaly.severity,
      factors: anomaly.factors,
      zScore: anomaly.zScore,
      timestamp: new Date().toISOString(),
      correlationId,
    },
  });
  return id;
}
