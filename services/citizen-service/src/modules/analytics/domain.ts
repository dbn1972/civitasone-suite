import type { DeliveryMetricRow } from "./schema.js";

export function aggregateSlaMetrics(metrics: DeliveryMetricRow[]): {
  totalPending: number; totalResolved: number; avgDays: number;
} {
  let totalPending = 0;
  let totalResolved = 0;
  let avgSum = 0;
  for (const m of metrics) {
    totalPending += m.pendingCount;
    totalResolved += m.resolvedCount;
    avgSum += Number(m.avgDays);
  }
  return {
    totalPending,
    totalResolved,
    avgDays: metrics.length ? avgSum / metrics.length : 0,
  };
}
