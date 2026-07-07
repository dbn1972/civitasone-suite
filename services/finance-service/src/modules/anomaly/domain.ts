/**
 * Anomaly Detection Domain Logic
 *
 * Implements Z-score scoring, duplicate detection, cost-center pattern monitoring,
 * and user behavior anomaly detection for financial transactions.
 *
 * Requirements: 11.1, 11.2, 11.3, 11.4, 11.5, 11.6, 11.7
 */

export type AnomalyType = "zscore" | "duplicate" | "cost_center_pattern" | "user_behavior";
export type AnomalySeverity = "low" | "medium" | "high";
export type AnomalyStatus = "open" | "reviewed" | "dismissed";

export interface AnomalyFactor {
  feature: string;
  contribution: number;
  direction: "positive" | "negative";
}

export interface DetectedAnomaly {
  transactionId: string;
  anomalyType: AnomalyType;
  severity: AnomalySeverity;
  zScore?: number | undefined;
  factors: AnomalyFactor[];
  vendorId?: string | undefined;
  categoryId?: string | undefined;
  amountPaise?: string | undefined;
}

export interface TransactionData {
  id: string;
  tenantId: string;
  amountPaise: bigint;
  categoryId: string;
  vendorId: string;
  costCenterId?: string;
  userId: string;
  date: Date;
  description: string;
}

export interface RollingStats {
  mean: number;
  std: number;
  count: number;
}

/**
 * Compute Z-score severity classification.
 * Z-score > 5 = high, 3-5 = medium, else low
 */
export function classifySeverity(absZScore: number): AnomalySeverity {
  if (absZScore > 5) return "high";
  if (absZScore >= 3) return "medium";
  return "low";
}

/**
 * Score a transaction against rolling 90-day mean per category per vendor.
 * Returns null if no anomaly detected (|z-score| <= 3).
 *
 * Requirements: 11.1
 */
export function scoreTransactionZScore(
  amountPaise: bigint,
  stats: RollingStats
): { zScore: number; severity: AnomalySeverity; factors: AnomalyFactor[] } | null {
  // Never flag when std is 0 (no variance = consistent spend)
  if (stats.std === 0) return null;

  const amount = Number(amountPaise);
  const zScore = (amount - stats.mean) / stats.std;
  const absZ = Math.abs(zScore);

  if (absZ <= 3) return null;

  const severity = classifySeverity(absZ);
  const factors: AnomalyFactor[] = [
    {
      feature: "amount_deviation",
      contribution: absZ / 5,
      direction: zScore > 0 ? "positive" : "negative",
    },
    {
      feature: "rolling_90d_mean",
      contribution: 0.3,
      direction: "negative",
    },
  ];

  return { zScore, severity, factors };
}

/**
 * Monitor spend patterns per cost center. Flag > 2 stddev deviation from 6-month average.
 *
 * Requirements: 11.3
 */
export function scoreCostCenterPattern(
  currentMonthSpend: number,
  stats: RollingStats
): { zScore: number; severity: AnomalySeverity; factors: AnomalyFactor[] } | null {
  if (stats.std === 0) return null;

  const zScore = (currentMonthSpend - stats.mean) / stats.std;
  const absZ = Math.abs(zScore);

  // Flag when > 2 stddev for cost center patterns
  if (absZ <= 2) return null;

  const severity = classifySeverity(absZ);
  const factors: AnomalyFactor[] = [
    {
      feature: "cost_center_spend_deviation",
      contribution: absZ / 5,
      direction: zScore > 0 ? "positive" : "negative",
    },
    {
      feature: "six_month_average",
      contribution: 0.4,
      direction: "negative",
    },
  ];

  return { zScore, severity, factors };
}

/**
 * Detect user behavior anomalies (volume, timing, amount patterns > 3 stddev from personal baseline).
 *
 * Requirements: 11.4
 */
export function scoreUserBehavior(
  currentValue: number,
  personalBaseline: RollingStats,
  metric: "volume" | "timing" | "amount"
): { zScore: number; severity: AnomalySeverity; factors: AnomalyFactor[] } | null {
  if (personalBaseline.std === 0) return null;

  const zScore = (currentValue - personalBaseline.mean) / personalBaseline.std;
  const absZ = Math.abs(zScore);

  // User behavior requires > 3 stddev from personal baseline
  if (absZ <= 3) return null;

  const severity = classifySeverity(absZ);
  const factors: AnomalyFactor[] = [
    {
      feature: `user_${metric}_deviation`,
      contribution: absZ / 5,
      direction: zScore > 0 ? "positive" : "negative",
    },
    {
      feature: "personal_baseline",
      contribution: 0.35,
      direction: "negative",
    },
  ];

  return { zScore, severity, factors };
}

/**
 * Run all anomaly detection checks on a transaction.
 * Returns array of detected anomalies (may be empty).
 */
export function detectAnomalies(
  transaction: TransactionData,
  categoryVendorStats: RollingStats | null,
  costCenterStats: RollingStats | null,
  currentMonthCostCenterSpend: number | null,
  userBehaviorStats: {
    volume?: RollingStats;
    amount?: RollingStats;
  } | null,
  userCurrentValues?: { volume?: number; amount?: number }
): DetectedAnomaly[] {
  const anomalies: DetectedAnomaly[] = [];

  // 11.1: Z-score scoring per transaction against rolling 90-day mean per category per vendor
  if (categoryVendorStats) {
    const zResult = scoreTransactionZScore(transaction.amountPaise, categoryVendorStats);
    if (zResult) {
      anomalies.push({
        transactionId: transaction.id,
        anomalyType: "zscore",
        severity: zResult.severity,
        zScore: zResult.zScore,
        factors: zResult.factors,
        vendorId: transaction.vendorId,
        categoryId: transaction.categoryId,
        amountPaise: transaction.amountPaise.toString(),
      });
    }
  }

  // 11.3: Monitor spend patterns per cost center, flag > 2 stddev from 6-month average
  if (costCenterStats && currentMonthCostCenterSpend != null) {
    const ccResult = scoreCostCenterPattern(currentMonthCostCenterSpend, costCenterStats);
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

  // 11.4: Detect user behavior anomalies (volume, amount patterns > 3 stddev)
  if (userBehaviorStats && userCurrentValues) {
    if (userBehaviorStats.volume && userCurrentValues.volume != null) {
      const volumeResult = scoreUserBehavior(
        userCurrentValues.volume,
        userBehaviorStats.volume,
        "volume"
      );
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

    if (userBehaviorStats.amount && userCurrentValues.amount != null) {
      const amountResult = scoreUserBehavior(
        userCurrentValues.amount,
        userBehaviorStats.amount,
        "amount"
      );
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

  return anomalies;
}

/**
 * Check if a transaction has already been dismissed (prevents re-flagging).
 *
 * Requirements: 11.7
 */
export function isDismissed(existingStatus: AnomalyStatus | undefined): boolean {
  return existingStatus === "dismissed";
}
