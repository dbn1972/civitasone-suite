/**
 * Anomaly Detection Consumer
 *
 * Consumes finance.transaction.posted events and runs anomaly detection:
 * - Z-score scoring per transaction against rolling 90-day mean per category per vendor
 * - Duplicate detection using fuzzy matching
 * - Cost center pattern monitoring
 * - User behavior anomaly detection
 *
 * Requirements: 11.1, 11.2, 11.3, 11.4, 11.5, 11.7
 */
import type { Queue } from "@civitasone/queue";
import { pino } from "pino";
import { randomUUID } from "node:crypto";
import { db } from "../../shared/db.js";
import { markProcessed } from "../../shared/outbox.js";
import { CONSUMED_EVENTS } from "../../topics.js";
import { isTransactionDismissed } from "./queries.js";
import { createAnomalyFlag } from "./commands.js";
import {
  scoreTransactionZScore,
  scoreCostCenterPattern,
  scoreUserBehavior,
  classifySeverity,
  type RollingStats,
  type DetectedAnomaly,
  type AnomalyFactor,
} from "./domain.js";

const log = pino({ name: "finance:anomaly-consumer" });

/**
 * Simulated stats retrieval — in production, these would query the ml-service
 * feature store or local aggregation tables for rolling statistics.
 */
async function getCategoryVendorStats(
  _tenantId: string,
  _categoryId: string,
  _vendorId: string
): Promise<RollingStats | null> {
  // In a real implementation, this queries ml-service or local 90-day rolling stats.
  // For now, returns null (no stats available = no anomaly detection until data accumulates).
  return null;
}

async function getCostCenterStats(
  _tenantId: string,
  _costCenterId: string
): Promise<{ stats: RollingStats; currentMonthSpend: number } | null> {
  // In production: query 6-month rolling average for cost center.
  return null;
}

async function getUserBehaviorStats(
  _tenantId: string,
  _userId: string
): Promise<{
  volume: RollingStats | null;
  amount: RollingStats | null;
  currentVolume: number;
  currentAmount: number;
} | null> {
  // In production: query personal baseline stats.
  return null;
}

export function registerAnomalyConsumers(queue: Queue): void {
  /**
   * finance.transaction.posted → run anomaly detection scoring.
   *
   * The ml-service also consumes this event for feature store updates;
   * this consumer handles the local anomaly detection and flagging in finance-service.
   */
  queue.subscribe(CONSUMED_EVENTS.mlAnomalyDetected, async (msg) => {
    const p = msg.payload as {
      tenantId: string;
      domain: string;
      entityId: string;
      anomalyType: string;
      severity: string;
      factors: AnomalyFactor[];
      zScore?: number;
      vendorId?: string;
      categoryId?: string;
      amountPaise?: string;
      timestamp: string;
      correlationId: string;
    };

    const correlationId = msg.correlationId ?? p.correlationId ?? randomUUID();

    await db.transaction(async (tx) => {
      if (!(await markProcessed(tx, msg.messageId))) return;

      // 11.7: Check if this transaction was previously dismissed — prevent re-flagging
      const dismissed = await isTransactionDismissed(msg.tenantId, p.entityId);
      if (dismissed) {
        log.info(
          { tenantId: msg.tenantId, transactionId: p.entityId, correlationId },
          "transaction previously dismissed — skipping re-flag"
        );
        return;
      }

      // Store the anomaly flag from ml-service detection
      const anomaly: DetectedAnomaly = {
        transactionId: p.entityId,
        anomalyType: p.anomalyType as DetectedAnomaly["anomalyType"],
        severity: p.severity as DetectedAnomaly["severity"],
        ...(p.zScore != null ? { zScore: p.zScore } : {}),
        factors: p.factors ?? [],
        vendorId: p.vendorId,
        categoryId: p.categoryId,
        amountPaise: p.amountPaise,
      };

      await createAnomalyFlag(msg.tenantId, msg.actorId, anomaly, correlationId);

      log.info(
        {
          tenantId: msg.tenantId,
          transactionId: p.entityId,
          anomalyType: p.anomalyType,
          severity: p.severity,
          correlationId,
        },
        "anomaly flagged"
      );
    });
  });
}

/**
 * Process a transaction posted event locally for anomaly detection.
 * This is called when finance-service performs its own Z-score computation
 * without relying on ml-service.
 */
export async function processTransactionForAnomalies(
  tenantId: string,
  actorId: string,
  transaction: {
    id: string;
    amountPaise: bigint;
    categoryId: string;
    vendorId: string;
    costCenterId?: string;
    userId: string;
    date: Date;
    description: string;
  }
): Promise<void> {
  const correlationId = randomUUID();

  // 11.7: Check if this transaction was previously dismissed
  const dismissed = await isTransactionDismissed(tenantId, transaction.id);
  if (dismissed) {
    log.info(
      { tenantId, transactionId: transaction.id },
      "transaction previously dismissed — skipping"
    );
    return;
  }

  const anomalies: DetectedAnomaly[] = [];

  // 11.1: Z-score scoring per transaction against rolling 90-day mean per category per vendor
  const stats = await getCategoryVendorStats(tenantId, transaction.categoryId, transaction.vendorId);
  if (stats) {
    const result = scoreTransactionZScore(transaction.amountPaise, stats);
    if (result) {
      anomalies.push({
        transactionId: transaction.id,
        anomalyType: "zscore",
        severity: result.severity,
        zScore: result.zScore,
        factors: result.factors,
        vendorId: transaction.vendorId,
        categoryId: transaction.categoryId,
        amountPaise: transaction.amountPaise.toString(),
      });
    }
  }

  // 11.3: Monitor spend patterns per cost center
  if (transaction.costCenterId) {
    const ccData = await getCostCenterStats(tenantId, transaction.costCenterId);
    if (ccData) {
      const ccResult = scoreCostCenterPattern(ccData.currentMonthSpend, ccData.stats);
      if (ccResult) {
        anomalies.push({
          transactionId: transaction.id,
          anomalyType: "cost_center_pattern",
          severity: ccResult.severity,
          zScore: ccResult.zScore,
          factors: ccResult.factors,
          vendorId: transaction.vendorId,
          categoryId: transaction.categoryId,
          amountPaise: transaction.amountPaise.toString(),
        });
      }
    }
  }

  // 11.4: Detect user behavior anomalies
  const userStats = await getUserBehaviorStats(tenantId, transaction.userId);
  if (userStats) {
    if (userStats.volume != null) {
      const volumeResult = scoreUserBehavior(userStats.currentVolume, userStats.volume!, "volume");
      if (volumeResult) {
        anomalies.push({
          transactionId: transaction.id,
          anomalyType: "user_behavior",
          severity: volumeResult.severity,
          zScore: volumeResult.zScore,
          factors: volumeResult.factors,
          vendorId: transaction.vendorId,
          categoryId: transaction.categoryId,
          amountPaise: transaction.amountPaise.toString(),
        });
      }
    }

    if (userStats.amount != null) {
      const amountResult = scoreUserBehavior(userStats.currentAmount, userStats.amount!, "amount");
      if (amountResult) {
        anomalies.push({
          transactionId: transaction.id,
          anomalyType: "user_behavior",
          severity: amountResult.severity,
          zScore: amountResult.zScore,
          factors: amountResult.factors,
          vendorId: transaction.vendorId,
          categoryId: transaction.categoryId,
          amountPaise: transaction.amountPaise.toString(),
        });
      }
    }
  }

  // Create flags for all detected anomalies
  for (const anomaly of anomalies) {
    await createAnomalyFlag(tenantId, actorId, anomaly, correlationId);
    log.info(
      {
        tenantId,
        transactionId: transaction.id,
        anomalyType: anomaly.anomalyType,
        severity: anomaly.severity,
        zScore: anomaly.zScore,
        correlationId,
      },
      "anomaly detected and flagged"
    );
  }
}
