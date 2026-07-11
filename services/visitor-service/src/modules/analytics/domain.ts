/**
 * visitor-service: analytics — pure domain logic.
 *
 * Owns:
 *   - Daily-metrics aggregation (Requirement 19.1): total visits, unique
 *     visitors, average approval turnaround, average visit duration, peak-hour
 *     distribution, and no-show rate.
 *   - Weekly/monthly trend computation (Requirements 19.2, 19.3): aggregates
 *     pre-computed daily metrics into period buckets for trend comparison.
 *
 * This module performs no I/O. Callers (routes.ts, nightly worker) load
 * visit/check-in records via repo.ts or DB queries, pass them here for
 * computation, and persist/return the result themselves.
 */

// ── Types ────────────────────────────────────────────────────────────────

/**
 * A flattened projection of a completed visit, combining data from
 * `visit_requests` and `check_ins`. Callers construct this by joining
 * the two tables before invoking domain functions — keeps this module
 * pure and I/O-free.
 */
export interface VisitRecord {
  /** Unique visit request ID. */
  visitId: string;
  /** Visitor identifier (used for unique-visitor counting). */
  visitorId: string;
  /**
   * Visit request status at the time of aggregation.
   * Relevant values: "approved" | "no_show" | "checked_in" | "checked_out" | etc.
   */
  status: string;
  /** Timestamp when the visit request was created. */
  createdAt: Date;
  /** Timestamp when the visit was approved (null if never approved). */
  approvedAt: Date | null;
  /** Timestamp when the visitor checked in at the gate (null if no check-in). */
  checkedInAt: Date | null;
  /** Timestamp when the visitor checked out (null if not yet checked out). */
  checkedOutAt: Date | null;
}

/**
 * Output shape of `computeDailyMetrics` — a snapshot of one day's
 * aggregated visitor metrics. Matches the `visitor.daily_metrics` table
 * schema for direct persistence by the nightly worker.
 */
export interface DailyMetrics {
  /** Total visit records processed for the day. */
  totalVisits: number;
  /** Count of distinct visitor IDs seen during the day. */
  uniqueVisitors: number;
  /**
   * Average time (ms) from visit request creation to approval.
   * `null` when no visits were approved during the period.
   */
  avgApprovalTurnaroundMs: number | null;
  /**
   * Average visit duration (ms) from check-in to check-out.
   * `null` when no completed (checked-out) visits occurred.
   */
  avgVisitDurationMs: number | null;
  /**
   * Distribution of check-ins by hour of day (0–23).
   * Keys are hour numbers; values are the count of check-ins in that hour.
   * Hours with zero check-ins are omitted.
   */
  peakHourDistribution: Record<number, number>;
  /**
   * Ratio of no-show visits to total visits (0–1 inclusive).
   * 0 when totalVisits is 0 (no division-by-zero).
   */
  noShowRate: number;
}

/**
 * A stored daily metric row — the shape returned by the DB and consumed
 * by `computeTrends`. Matches the `visitor.daily_metrics` table exactly.
 */
export interface DailyMetric {
  /** The date this metric row represents (start of day, UTC). */
  date: Date;
  totalVisits: number;
  uniqueVisitors: number;
  avgApprovalTimeMs: number | null;
  avgVisitDurationMs: number | null;
  peakHour: number | null;
  noShowCount: number;
}

/**
 * Aggregated trend data for a single period bucket (one week or one month).
 */
export interface TrendBucket {
  /** Start of the period (inclusive). */
  periodStart: Date;
  /** End of the period (exclusive). */
  periodEnd: Date;
  /** Total visits across all days in this period. */
  totalVisits: number;
  /** Total unique visitors (sum of daily unique — an upper-bound approximation). */
  uniqueVisitors: number;
  /** Average of daily avgApprovalTimeMs values (null-safe). */
  avgApprovalTimeMs: number | null;
  /** Average of daily avgVisitDurationMs values (null-safe). */
  avgVisitDurationMs: number | null;
  /** Most common peak hour across days in this period (mode). */
  peakHour: number | null;
  /** Total no-show count across the period. */
  noShowCount: number;
  /** Number of days with data in this bucket. */
  daysWithData: number;
}

/**
 * Full trend response containing an ordered list of period buckets.
 */
export interface TrendData {
  period: "weekly" | "monthly";
  buckets: TrendBucket[];
}

// ── Daily Metrics Computation ────────────────────────────────────────────

/**
 * Computes aggregated daily metrics from a list of visit records for a
 * single day (Requirement 19.1).
 *
 * Pure and deterministic: no I/O, no side effects, no date/time dependency
 * beyond what's in the input records.
 *
 * @param visits - All visit records for the target day (any status).
 * @returns Aggregated metrics snapshot.
 */
export function computeDailyMetrics(visits: readonly VisitRecord[]): DailyMetrics {
  if (visits.length === 0) {
    return {
      totalVisits: 0,
      uniqueVisitors: 0,
      avgApprovalTurnaroundMs: null,
      avgVisitDurationMs: null,
      peakHourDistribution: {},
      noShowRate: 0,
    };
  }

  const totalVisits = visits.length;

  // Unique visitors by visitorId
  const uniqueVisitorIds = new Set<string>();
  for (const v of visits) {
    uniqueVisitorIds.add(v.visitorId);
  }
  const uniqueVisitors = uniqueVisitorIds.size;

  // Average approval turnaround (createdAt → approvedAt)
  let approvalSum = 0;
  let approvalCount = 0;
  for (const v of visits) {
    if (v.approvedAt !== null) {
      const turnaround = v.approvedAt.getTime() - v.createdAt.getTime();
      if (turnaround >= 0) {
        approvalSum += turnaround;
        approvalCount += 1;
      }
    }
  }
  const avgApprovalTurnaroundMs = approvalCount > 0
    ? Math.round(approvalSum / approvalCount)
    : null;

  // Average visit duration (checkedInAt → checkedOutAt)
  let durationSum = 0;
  let durationCount = 0;
  for (const v of visits) {
    if (v.checkedInAt !== null && v.checkedOutAt !== null) {
      const duration = v.checkedOutAt.getTime() - v.checkedInAt.getTime();
      if (duration >= 0) {
        durationSum += duration;
        durationCount += 1;
      }
    }
  }
  const avgVisitDurationMs = durationCount > 0
    ? Math.round(durationSum / durationCount)
    : null;

  // Peak hour distribution (hour of check-in, 0–23)
  const peakHourDistribution: Record<number, number> = {};
  for (const v of visits) {
    if (v.checkedInAt !== null) {
      const hour = v.checkedInAt.getUTCHours();
      peakHourDistribution[hour] = (peakHourDistribution[hour] ?? 0) + 1;
    }
  }

  // No-show rate
  let noShowCount = 0;
  for (const v of visits) {
    if (v.status === "no_show") {
      noShowCount += 1;
    }
  }
  const noShowRate = totalVisits > 0 ? noShowCount / totalVisits : 0;

  return {
    totalVisits,
    uniqueVisitors,
    avgApprovalTurnaroundMs,
    avgVisitDurationMs,
    peakHourDistribution,
    noShowRate,
  };
}

// ── Trend Computation ────────────────────────────────────────────────────

/**
 * Groups pre-computed daily metrics into weekly or monthly trend buckets
 * (Requirements 19.2, 19.3).
 *
 * - **weekly**: ISO week buckets (Monday–Sunday). Each bucket covers 7 days.
 * - **monthly**: Calendar month buckets (1st–last day of month).
 *
 * Buckets are ordered chronologically. Empty buckets (periods with no
 * daily metric rows) are omitted — only periods containing at least one
 * day of data produce a bucket.
 *
 * Pure and deterministic.
 *
 * @param dailyMetrics - Pre-computed daily metric rows, any order.
 * @param period - Grouping period: "weekly" or "monthly".
 * @returns Aggregated trend data with ordered buckets.
 */
export function computeTrends(
  dailyMetrics: readonly DailyMetric[],
  period: "weekly" | "monthly",
): TrendData {
  if (dailyMetrics.length === 0) {
    return { period, buckets: [] };
  }

  // Group metrics by period bucket key
  const bucketMap = new Map<string, DailyMetric[]>();

  for (const metric of dailyMetrics) {
    const key = period === "weekly"
      ? getISOWeekKey(metric.date)
      : getMonthKey(metric.date);

    const existing = bucketMap.get(key);
    if (existing) {
      existing.push(metric);
    } else {
      bucketMap.set(key, [metric]);
    }
  }

  // Aggregate each bucket
  const buckets: TrendBucket[] = [];

  for (const [key, metrics] of bucketMap) {
    const { start, end } = period === "weekly"
      ? getISOWeekBounds(key)
      : getMonthBounds(key);

    buckets.push(aggregateBucket(start, end, metrics));
  }

  // Sort chronologically by periodStart
  buckets.sort((a, b) => a.periodStart.getTime() - b.periodStart.getTime());

  return { period, buckets };
}

// ── Internal Helpers ─────────────────────────────────────────────────────

/**
 * Returns an ISO week key like "2024-W03" for grouping. ISO 8601 weeks
 * start on Monday.
 */
function getISOWeekKey(date: Date): string {
  const year = getISOWeekYear(date);
  const week = getISOWeekNumber(date);
  return `${year}-W${String(week).padStart(2, "0")}`;
}

/** Returns a month key like "2024-07" for grouping. */
function getMonthKey(date: Date): string {
  const year = date.getUTCFullYear();
  const month = date.getUTCMonth() + 1;
  return `${year}-${String(month).padStart(2, "0")}`;
}

/**
 * Returns the ISO 8601 week number (1–53) for the given date.
 * ISO weeks start on Monday; the first week contains the year's first Thursday.
 */
function getISOWeekNumber(date: Date): number {
  const d = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()));
  // Set to nearest Thursday: current date + 4 - dayOfWeek (Mon=1..Sun=7)
  const dayOfWeek = d.getUTCDay() || 7; // Convert Sunday (0) to 7
  d.setUTCDate(d.getUTCDate() + 4 - dayOfWeek);
  const yearStart = new Date(Date.UTC(d.getUTCFullYear(), 0, 1));
  const weekNo = Math.ceil(((d.getTime() - yearStart.getTime()) / 86_400_000 + 1) / 7);
  return weekNo;
}

/**
 * Returns the ISO week-numbering year for the given date.
 * This may differ from the calendar year for dates near year boundaries.
 */
function getISOWeekYear(date: Date): number {
  const d = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()));
  const dayOfWeek = d.getUTCDay() || 7;
  d.setUTCDate(d.getUTCDate() + 4 - dayOfWeek);
  return d.getUTCFullYear();
}

/** Returns start (Monday 00:00 UTC) and end (next Monday 00:00 UTC) for an ISO week key. */
function getISOWeekBounds(key: string): { start: Date; end: Date } {
  const [yearStr, weekStr] = key.split("-W");
  const year = Number(yearStr);
  const week = Number(weekStr);

  // January 4 is always in ISO week 1
  const jan4 = new Date(Date.UTC(year, 0, 4));
  const jan4DayOfWeek = jan4.getUTCDay() || 7; // Mon=1..Sun=7
  // Monday of ISO week 1
  const week1Monday = new Date(jan4.getTime() - (jan4DayOfWeek - 1) * 86_400_000);
  // Monday of target week
  const start = new Date(week1Monday.getTime() + (week - 1) * 7 * 86_400_000);
  const end = new Date(start.getTime() + 7 * 86_400_000);

  return { start, end };
}

/** Returns start (1st 00:00 UTC) and end (1st of next month 00:00 UTC) for a month key. */
function getMonthBounds(key: string): { start: Date; end: Date } {
  const [yearStr, monthStr] = key.split("-");
  const year = Number(yearStr);
  const month = Number(monthStr) - 1; // 0-indexed for Date constructor

  const start = new Date(Date.UTC(year, month, 1));
  const end = new Date(Date.UTC(year, month + 1, 1));

  return { start, end };
}

/**
 * Aggregates a set of daily metrics into a single trend bucket.
 */
function aggregateBucket(
  periodStart: Date,
  periodEnd: Date,
  metrics: readonly DailyMetric[],
): TrendBucket {
  let totalVisits = 0;
  let uniqueVisitors = 0;
  let noShowCount = 0;
  let approvalTimeSum = 0;
  let approvalTimeCount = 0;
  let durationSum = 0;
  let durationCount = 0;

  // Count peak hours to find the mode
  const peakHourCounts = new Map<number, number>();

  for (const m of metrics) {
    totalVisits += m.totalVisits;
    uniqueVisitors += m.uniqueVisitors;
    noShowCount += m.noShowCount;

    if (m.avgApprovalTimeMs !== null) {
      approvalTimeSum += m.avgApprovalTimeMs;
      approvalTimeCount += 1;
    }

    if (m.avgVisitDurationMs !== null) {
      durationSum += m.avgVisitDurationMs;
      durationCount += 1;
    }

    if (m.peakHour !== null) {
      peakHourCounts.set(m.peakHour, (peakHourCounts.get(m.peakHour) ?? 0) + 1);
    }
  }

  // Mode of peak hours
  let peakHour: number | null = null;
  let maxPeakCount = 0;
  for (const [hour, count] of peakHourCounts) {
    if (count > maxPeakCount) {
      maxPeakCount = count;
      peakHour = hour;
    }
  }

  return {
    periodStart,
    periodEnd,
    totalVisits,
    uniqueVisitors,
    avgApprovalTimeMs: approvalTimeCount > 0
      ? Math.round(approvalTimeSum / approvalTimeCount)
      : null,
    avgVisitDurationMs: durationCount > 0
      ? Math.round(durationSum / durationCount)
      : null,
    peakHour,
    noShowCount,
    daysWithData: metrics.length,
  };
}
