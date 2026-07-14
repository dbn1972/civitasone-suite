/**
 * Pure domain rules for the case-registry module: CNR validation, the case
 * lifecycle state machine, and initial-status derivation. No I/O — every
 * function here is deterministic and side-effect free so it is trivially
 * unit-testable and safe to call from both the command and consumer paths.
 */

export const CASE_STATUSES = [
  "filed",
  "registered",
  "admitted",
  "pending",
  "part_heard",
  "reserved",
  "disposed",
  "appealed",
] as const;
export type CaseStatus = typeof CASE_STATUSES[number];

/**
 * The canonical CNR (Case Number Record) is a 16-character alphanumeric code:
 * 4-letter court/establishment code + 12 digits (e.g. DLHC01-0001234-2026 with
 * separators stripped). We guard the normalized (separator-free) form here and
 * leave presentational formatting to the UI.
 */
const CNR_RE = /^[A-Za-z0-9]{16}$/;

export function normalizeCnr(cnr: string): string {
  return cnr.replace(/[^A-Za-z0-9]/g, "").toUpperCase();
}

export function validateCnr(cnr: string): string {
  const normalized = normalizeCnr(cnr);
  if (!CNR_RE.test(normalized)) {
    throw new Error(`INVALID_CNR: '${cnr}' is not a valid 16-character CNR number`);
  }
  return normalized;
}

/** Every newly filed case starts in the 'filed' state. */
export function deriveInitialStatus(): CaseStatus {
  return "filed";
}

/**
 * Case lifecycle: filed → registered → admitted → pending → part_heard →
 * reserved → disposed → appealed. Realistic side-branches are allowed
 * (a reserved matter can return to part_heard for further hearing; an appealed
 * matter re-enters the pipeline as pending in the appellate forum) but the
 * forward spine is the contract.
 */
const TRANSITIONS: Record<CaseStatus, CaseStatus[]> = {
  filed:      ["registered"],
  registered: ["admitted"],
  admitted:   ["pending"],
  pending:    ["part_heard", "reserved", "disposed"],
  part_heard: ["reserved", "pending", "disposed"],
  reserved:   ["disposed", "part_heard"],
  disposed:   ["appealed"],
  appealed:   ["pending"],
};

export function canTransition(from: CaseStatus, to: CaseStatus): boolean {
  return TRANSITIONS[from]?.includes(to) ?? false;
}

export function assertTransition(from: string, to: CaseStatus): void {
  if (!canTransition(from as CaseStatus, to)) {
    throw new Error(`INVALID_TRANSITION: cannot move case from '${from}' to '${to}'`);
  }
}

/**
 * Default case-type categories (§5) used as a FALLBACK when a tenant has not
 * configured its own `case_type` namespace in the config/metadata engine
 * (§47). The effective allowed set is the tenant’s configured `case_type`
 * values when any exist (AUTHORITATIVE — it REPLACES these defaults), else
 * these module defaults. Configuring the namespace fully overrides the
 * fallback: the tenant’s list must include every category it still wants
 * (these standards are NOT implicitly retained) and may add bespoke types
 * with no code change.
 */
export const DEFAULT_CASE_TYPES = [
  "civil", "revenue_appeal", "mutation", "partition", "land_acquisition",
  "consumer_complaint", "execution", "revision", "review",
  "misc_application", "tenancy", "criminal",
] as const;

/** Throw INVALID_CASE_TYPE unless `caseType` is in the effective allowed set. */
export function assertCaseTypeAllowed(caseType: string, allowed: ReadonlySet<string>): void {
  if (!allowed.has(caseType)) {
    throw new Error(`INVALID_CASE_TYPE: ${caseType} is not an allowed case type for this tenant`);
  }
}

/** Default target disposal window (days) when a tenant has no sla_timer config. */
export const DEFAULT_DISPOSAL_DAYS = 180;

/** Resolve the disposal-day window from an sla_timer config value (§47).
 * Expects `{ disposalDays: <positive int> }`; falls back to `defaultDays` on an
 * absent or malformed value (SLA target is advisory — never block registration). */
export function resolveDisposalDays(configValue: unknown, defaultDays: number): number {
  if (configValue && typeof configValue === "object") {
    const dd = (configValue as Record<string, unknown>).disposalDays;
    if (Number.isInteger(dd) && (dd as number) > 0) return dd as number;
  }
  return defaultDays;
}

/** Add `days` calendar days to a YYYY-MM-DD date, returning YYYY-MM-DD (UTC, no
 * timezone drift). Used to compute the target disposal date from the filing date. */
export function addDays(isoDate: string, days: number): string {
  const parts = isoDate.slice(0, 10).split("-");
  const y = Number(parts[0] ?? "1970");
  const m = Number(parts[1] ?? "1");
  const d = Number(parts[2] ?? "1");
  const dt = new Date(Date.UTC(y, m - 1, d));
  dt.setUTCDate(dt.getUTCDate() + days);
  return dt.toISOString().slice(0, 10);
}
