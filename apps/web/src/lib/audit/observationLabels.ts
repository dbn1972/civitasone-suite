// Single source of truth for audit-observation severity + status vocabularies
// and the fiscal-year / lifecycle predicates used by the observations list,
// the KPI tiles and the detail page. Keeping these together prevents the
// "list says X, tile says Y" drift (GAP-AUDIT-OBSERVATIONS-01/02) and the raw
// enum / wrong-pill rendering (GAP-AUDIT-OBSERVATIONS-DETAIL-04/05).
//
// Severity enum is the one declared in @civitasone/types AuditObservationSummary:
//   "critical" | "major" | "minor" | "observation"
// Status enum is:
//   "open" | "replied" | "partially_closed" | "closed" | "compliance_pending"
// Any value outside these must render a neutral pill with the RAW text — never
// silently collapse to "Low"/"Open" (that is the bug this module replaces).

export type SeverityKey = "critical" | "major" | "minor" | "observation";
export type StatusKey =
  | "open"
  | "replied"
  | "partially_closed"
  | "closed"
  | "compliance_pending";

export interface SeverityMeta {
  label: string;
  /** ds pill modifier class, e.g. "bad" | "warn" | "info" | "mut" */
  pill: "bad" | "warn" | "info" | "mut" | "good";
}

export interface StatusMeta {
  label: string;
  pill: "bad" | "warn" | "info" | "mut" | "good";
}

const SEVERITY: Record<SeverityKey, SeverityMeta> = {
  critical: { label: "Critical", pill: "bad" },
  major: { label: "High", pill: "bad" },
  minor: { label: "Medium", pill: "warn" },
  observation: { label: "Low", pill: "mut" },
};

const STATUS: Record<StatusKey, StatusMeta> = {
  open: { label: "Open", pill: "warn" },
  replied: { label: "Under reply", pill: "info" },
  compliance_pending: { label: "Compliance pending", pill: "warn" },
  partially_closed: { label: "Part-settled", pill: "info" },
  closed: { label: "Settled", pill: "good" },
};

/** Severity label + pill. Unknown values → neutral pill with the raw text. */
export function severityMeta(severity: string): SeverityMeta {
  return SEVERITY[severity as SeverityKey] ?? { label: severity, pill: "mut" };
}

/** Status label + pill. Unknown values → neutral pill with the raw text. */
export function statusMeta(status: string): StatusMeta {
  return STATUS[status as StatusKey] ?? { label: status, pill: "mut" };
}

// ── Lifecycle predicates (shared by page KPIs and the table segments) ──────────
// "Open" means any observation that is not yet settled (closed). This is the
// definition the Open segment already used; the KPI tile is aligned to it.
export function isOpen(status: string): boolean {
  return status !== "closed";
}

/** Settled = closed. */
export function isSettled(status: string): boolean {
  return status === "closed";
}

/** Awaiting / in the reply-review loop. */
export function isUnderReply(status: string): boolean {
  return (
    status === "replied" ||
    status === "compliance_pending" ||
    status === "partially_closed"
  );
}

/**
 * Indian fiscal year window (1 April → 31 March) containing `ref` (default now).
 * Returns inclusive [start, end) ISO-ish Date bounds in UTC.
 */
export function fiscalYearBounds(ref: Date = new Date()): { start: Date; end: Date } {
  const y = ref.getUTCFullYear();
  const month = ref.getUTCMonth(); // 0 = Jan
  // Jan–Mar belong to the FY that started the previous calendar year.
  const startYear = month < 3 ? y - 1 : y;
  const start = new Date(Date.UTC(startYear, 3, 1, 0, 0, 0, 0)); // 1 Apr
  const end = new Date(Date.UTC(startYear + 1, 3, 1, 0, 0, 0, 0)); // 1 Apr next year
  return { start, end };
}

/** True when an ISO date string falls inside the fiscal year of `ref`. */
export function inFiscalYear(isoDate: string | null | undefined, ref: Date = new Date()): boolean {
  if (!isoDate) return false;
  const t = Date.parse(isoDate);
  if (Number.isNaN(t)) return false;
  const { start, end } = fiscalYearBounds(ref);
  return t >= start.getTime() && t < end.getTime();
}
