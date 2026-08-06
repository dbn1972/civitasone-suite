/**
 * Pure programme domain (G12 — Spec §25.7, Journey J6).
 *
 * Everything here is a total function over plain values: no db, no cache, no queue. The
 * routes call it before returning 202 so a caller learns immediately that its command
 * would be refused, and the consumer calls it again before writing because the route's
 * read is only a snapshot.
 *
 * Three responsibilities:
 *  1. the programme lifecycle (draft → active → suspended ⇄ active → closed),
 *  2. what a valid programme code / coverage scope / period looks like,
 *  3. how a metric's raw value is interpreted — money as bigint minor units, everything
 *     else as an exact decimal string — and how a period's metrics roll up into the
 *     execution-health picture J6 asks for.
 */
import type { CoverageScope } from "./schema.js";

export const PROGRAMME_STATUSES = ["draft", "active", "suspended", "closed"] as const;
export type ProgrammeStatus = (typeof PROGRAMME_STATUSES)[number];

/** Status every programme is registered in. Registration is not activation. */
export const INITIAL_STATUS: ProgrammeStatus = "draft";

export const DEFAULT_PRODUCT_LINE = "government";

/**
 * `closed` is terminal. A government programme that has ended is superseded by a new
 * programme (with its own code and its own metric series), never reopened — reopening
 * would make the metric history ambiguous about which engagement it describes.
 *
 * `suspended` ⇄ `active` is the only loop: suspension is a real, reversible operational
 * state (funds withheld, stay order) and the programme keeps its identity through it.
 */
const TRANSITIONS: Readonly<Record<ProgrammeStatus, readonly ProgrammeStatus[]>> = {
  draft: ["active", "closed"],
  active: ["suspended", "closed"],
  suspended: ["active", "closed"],
  closed: [],
};

export function isProgrammeStatus(value: string): value is ProgrammeStatus {
  return (PROGRAMME_STATUSES as readonly string[]).includes(value);
}

export function allowedNextStatuses(status: ProgrammeStatus): readonly ProgrammeStatus[] {
  return TRANSITIONS[status];
}

export function canTransition(from: ProgrammeStatus, to: ProgrammeStatus): boolean {
  return TRANSITIONS[from].includes(to);
}

export function isTerminalStatus(status: ProgrammeStatus): boolean {
  return TRANSITIONS[status].length === 0;
}

/** Metrics may only be recorded against a programme that is (or has been) executing. */
export function acceptsMetrics(status: ProgrammeStatus): boolean {
  return status !== "draft";
}

// ── Programme code ──────────────────────────────────────────────────────────────────

/**
 * Uppercase alphanumerics plus `-` / `_` / `/`, 3–64 chars. Deliberately narrow: the code
 * is a machine key that ends up in report headers, file names and other tenants' systems,
 * so spaces and punctuation cause more damage than they save.
 */
export const PROGRAMME_CODE_PATTERN = /^[A-Z0-9][A-Z0-9\-_/]{2,63}$/;

/** Uppercase + trim so 'pmay-u' and 'PMAY-U' cannot both be registered in one tenant. */
export function normaliseProgrammeCode(code: string): string {
  return code.trim().toUpperCase();
}

export function isValidProgrammeCode(code: string): boolean {
  return PROGRAMME_CODE_PATTERN.test(normaliseProgrammeCode(code));
}

// ── Dates ───────────────────────────────────────────────────────────────────────────

/** ISO calendar dates only (YYYY-MM-DD); programmes are planned by date, not instant. */
const ISO_DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;

export function isIsoDate(value: string): boolean {
  if (!ISO_DATE_PATTERN.test(value)) return false;
  const parsed = new Date(`${value}T00:00:00Z`);
  if (Number.isNaN(parsed.getTime())) return false;
  // Rejects 2026-02-31, which Date would roll forward into March.
  return parsed.toISOString().slice(0, 10) === value;
}

/**
 * A range is ordered when either end is absent (an open-ended programme is normal) or
 * when start ≤ end. Mirrors the `programmes_dates_ordered` CHECK so the caller gets a
 * 400 instead of a 500 wrapping a constraint violation.
 */
export function isOrderedRange(
  start: string | null | undefined,
  end: string | null | undefined,
): boolean {
  if (!start || !end) return true;
  return start <= end;
}

// ── Coverage scope ──────────────────────────────────────────────────────────────────

export const MAX_COVERAGE_ENTRIES = 500;

function normaliseList(values: readonly string[] | undefined): string[] {
  if (!values) return [];
  const seen = new Set<string>();
  for (const raw of values) {
    const trimmed = raw.trim();
    if (trimmed.length > 0) seen.add(trimmed);
  }
  return [...seen].sort((a, b) => a.localeCompare(b));
}

/**
 * Trim, drop blanks, de-duplicate and sort each list. Sorting matters: coverage is
 * compared between periods to show scope creep, and an unstable order would make two
 * identical scopes look different.
 */
export function normaliseCoverageScope(scope: CoverageScope | undefined): CoverageScope {
  const regions = normaliseList(scope?.regions);
  const districts = normaliseList(scope?.districts);
  return {
    ...(regions.length > 0 ? { regions } : {}),
    ...(districts.length > 0 ? { districts } : {}),
  };
}

export function coverageEntryCount(scope: CoverageScope | undefined): number {
  const normalised = normaliseCoverageScope(scope);
  return (normalised.regions?.length ?? 0) + (normalised.districts?.length ?? 0);
}

// ── Metrics ─────────────────────────────────────────────────────────────────────────

export const METRIC_KINDS = ["money", "count", "ratio"] as const;
export type MetricKind = (typeof METRIC_KINDS)[number];

export function isMetricKind(value: string): value is MetricKind {
  return (METRIC_KINDS as readonly string[]).includes(value);
}

/** The metric keys J6 reports on by name. Tenants may record others freely. */
export const HEALTH_METRIC_KEYS = {
  volume: "volume",
  coverage: "coverage_ratio",
  exception: "exception_rate",
  grievance: "grievance_rate",
  revenue: "revenue",
} as const;

/**
 * Default kind for a metric key when the caller does not declare one. Anything that reads
 * as money is money — getting this wrong would put a rupee figure in a numeric column and
 * lose the currency, so the classification is keyword-based and conservative.
 */
export function classifyMetric(metricKey: string): MetricKind {
  const key = metricKey.trim().toLowerCase();
  if (/(^|_)(revenue|cost|amount|value|billing|invoiced|penalty|payout)(_|$)/.test(key)) {
    return "money";
  }
  if (/(ratio|rate|percent|pct|coverage)/.test(key)) return "ratio";
  return "count";
}

/** Money in minor units: an optionally-signed run of digits, nothing else. */
const MINOR_UNITS_PATTERN = /^-?\d{1,19}$/;

export function isValidMinorUnits(value: string): boolean {
  return MINOR_UNITS_PATTERN.test(value.trim());
}

/** Exact decimal, up to 6 fractional places — matches numeric(20,6) in the table. */
const DECIMAL_PATTERN = /^-?\d{1,13}(\.\d{1,6})?$/;

export function isValidDecimal(value: string): boolean {
  return DECIMAL_PATTERN.test(value.trim());
}

export const CURRENCY_PATTERN = /^[A-Z]{3}$/;
export const DEFAULT_CURRENCY = "INR";

export interface MetricValueInput {
  metricKey: string;
  metricKind?: MetricKind | undefined;
  /** Always a string on the wire — see the money rule. */
  value: string;
  currency?: string | undefined;
}

export interface NormalisedMetricValue {
  metricKind: MetricKind;
  valueMinor: bigint | null;
  valueNumeric: string | null;
  currency: string | null;
}

export type MetricValueResult =
  | { ok: true; value: NormalisedMetricValue }
  | { ok: false; code: string; message: string };

/**
 * Turn a raw metric submission into the exact column set the table's
 * `programme_metrics_value_matches_kind` CHECK expects, or explain why it cannot.
 *
 * Returns a result rather than throwing: domain code has no business knowing about HTTP,
 * and both the route (→ 400) and the consumer (→ rejected audit record) need the reason.
 */
export function normaliseMetricValue(input: MetricValueInput): MetricValueResult {
  const kind = input.metricKind ?? classifyMetric(input.metricKey);
  const raw = input.value.trim();

  if (kind === "money") {
    if (!isValidMinorUnits(raw)) {
      return {
        ok: false,
        code: "INVALID_MONEY_VALUE",
        message: `monetary metric '${input.metricKey}' must be an integer string of minor units, got '${input.value}'`,
      };
    }
    const currency = (input.currency ?? DEFAULT_CURRENCY).trim().toUpperCase();
    if (!CURRENCY_PATTERN.test(currency)) {
      return {
        ok: false,
        code: "INVALID_CURRENCY",
        message: `currency must be a 3-letter ISO 4217 code, got '${input.currency ?? ""}'`,
      };
    }
    return { ok: true, value: { metricKind: kind, valueMinor: BigInt(raw), valueNumeric: null, currency } };
  }

  if (!isValidDecimal(raw)) {
    return {
      ok: false,
      code: "INVALID_NUMERIC_VALUE",
      message: `metric '${input.metricKey}' must be a decimal with at most 6 fractional digits, got '${input.value}'`,
    };
  }
  if (input.currency !== undefined) {
    return {
      ok: false,
      code: "CURRENCY_NOT_APPLICABLE",
      message: `currency is only meaningful for monetary metrics; '${input.metricKey}' is a ${kind}`,
    };
  }
  if (kind === "ratio") {
    const asNumber = Number(raw);
    if (asNumber < 0 || asNumber > 1) {
      return {
        ok: false,
        code: "RATIO_OUT_OF_RANGE",
        message: `ratio metric '${input.metricKey}' must be a fraction between 0 and 1, got '${input.value}'`,
      };
    }
  }
  if (kind === "count" && raw.startsWith("-")) {
    return {
      ok: false,
      code: "NEGATIVE_COUNT",
      message: `count metric '${input.metricKey}' cannot be negative, got '${input.value}'`,
    };
  }
  return { ok: true, value: { metricKind: kind, valueMinor: null, valueNumeric: raw, currency: null } };
}

// ── Execution health ────────────────────────────────────────────────────────────────

export type HealthBand = "unknown" | "healthy" | "watch" | "at_risk";

export interface MetricSample {
  metricKey: string;
  metricKind: string;
  valueMinor: string | null;
  valueNumeric: string | null;
}

export interface ExecutionHealth {
  /** Delivery volume summed over the metrics supplied. */
  volume: number;
  /** Mean coverage ratio (0–1), null when never reported. */
  coverageRatio: number | null;
  exceptionRate: number | null;
  grievanceRate: number | null;
  /** Revenue in minor units as a STRING — this is money. */
  revenueMinor: string;
  band: HealthBand;
  metricCount: number;
}

/**
 * Thresholds for the health band. Chosen to match how a programme review actually reads:
 * coverage is the primary signal (are we reaching the districts we promised), exceptions
 * and grievances are the failure signals, and either one crossing its ceiling drags the
 * band down regardless of how good coverage looks.
 */
export const HEALTH_THRESHOLDS = {
  coverageWatch: 0.9,
  coverageAtRisk: 0.7,
  exceptionWatch: 0.05,
  exceptionAtRisk: 0.1,
  grievanceWatch: 0.02,
  grievanceAtRisk: 0.05,
} as const;

function mean(values: number[]): number | null {
  if (values.length === 0) return null;
  return values.reduce((a, b) => a + b, 0) / values.length;
}

/** Worst band wins: a programme is only as healthy as its weakest signal. */
export function healthBand(h: {
  coverageRatio: number | null;
  exceptionRate: number | null;
  grievanceRate: number | null;
}): HealthBand {
  const known = [h.coverageRatio, h.exceptionRate, h.grievanceRate].some((v) => v !== null);
  if (!known) return "unknown";
  const t = HEALTH_THRESHOLDS;
  if (
    (h.coverageRatio !== null && h.coverageRatio < t.coverageAtRisk) ||
    (h.exceptionRate !== null && h.exceptionRate > t.exceptionAtRisk) ||
    (h.grievanceRate !== null && h.grievanceRate > t.grievanceAtRisk)
  ) {
    return "at_risk";
  }
  if (
    (h.coverageRatio !== null && h.coverageRatio < t.coverageWatch) ||
    (h.exceptionRate !== null && h.exceptionRate > t.exceptionWatch) ||
    (h.grievanceRate !== null && h.grievanceRate > t.grievanceWatch)
  ) {
    return "watch";
  }
  return "healthy";
}

/**
 * Roll a programme's metric rows up into the J6 execution-health view.
 *
 * Revenue is summed with BigInt — never Number — so a programme whose lifetime billing
 * exceeds 2^53 paise still reports an exact figure. Volumes are counts and safely numeric.
 * Unrecognised metric keys are counted but do not influence the band: a tenant recording
 * its own metric must not be able to silently redefine what "at risk" means.
 */
export function summariseExecutionHealth(samples: readonly MetricSample[]): ExecutionHealth {
  let volume = 0;
  let revenueMinor = 0n;
  const coverage: number[] = [];
  const exceptions: number[] = [];
  const grievances: number[] = [];

  for (const s of samples) {
    const numeric = s.valueNumeric === null ? null : Number(s.valueNumeric);
    switch (s.metricKey) {
      case HEALTH_METRIC_KEYS.volume:
        if (numeric !== null) volume += numeric;
        break;
      case HEALTH_METRIC_KEYS.coverage:
        if (numeric !== null) coverage.push(numeric);
        break;
      case HEALTH_METRIC_KEYS.exception:
        if (numeric !== null) exceptions.push(numeric);
        break;
      case HEALTH_METRIC_KEYS.grievance:
        if (numeric !== null) grievances.push(numeric);
        break;
      case HEALTH_METRIC_KEYS.revenue:
        if (s.valueMinor !== null && isValidMinorUnits(s.valueMinor)) {
          revenueMinor += BigInt(s.valueMinor.trim());
        }
        break;
      default:
        break;
    }
  }

  const coverageRatio = mean(coverage);
  const exceptionRate = mean(exceptions);
  const grievanceRate = mean(grievances);

  return {
    volume,
    coverageRatio,
    exceptionRate,
    grievanceRate,
    revenueMinor: revenueMinor.toString(),
    band: healthBand({ coverageRatio, exceptionRate, grievanceRate }),
    metricCount: samples.length,
  };
}
