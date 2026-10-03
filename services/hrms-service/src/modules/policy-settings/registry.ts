/**
 * Per-tenant HR policy settings: key -> zod shape + conservative default.
 *
 * A tenant with no stored row for a key gets the default, so adding a key here
 * changes no behaviour until HR actually edits it. Values are validated with
 * the key's schema on every write AND on every read (a row written by an older
 * shape falls back to defaults field-by-field via .catch / .default).
 */
import { z } from "zod";

// ── wfh_eligibility (GAP-HR-WFH-01) ─────────────────────────────────────────
// DoPT WFH guidance restricts remote work to non-gazetted staff. A designation's
// `level` is the 7th CPC pay-matrix level (1-18, 0 = unclassified -- see
// apps/web/src/lib/payLevels.ts). Default: Level 10 and above (Group A /
// gazetted) are excluded. Unclassified (0) designations are NOT blocked: an
// unknown level must never wrongly deny someone; the form tells them it could
// not be verified instead.
export const wfhEligibilitySchema = z.object({
  enforceGazettedExclusion: z.boolean().default(true),
  // Highest level still ELIGIBLE: default 9, i.e. Level 10-18 (Group A) excluded.
  // Group B gazetted (Levels 8-9) is NOT covered by this default.
  maxPayLevel: z.number().int().min(1).max(18).default(9),
});
export type WfhEligibility = z.infer<typeof wfhEligibilitySchema>;

// ── apar_deadlines (GAP-HR-APAR-03) ─────────────────────────────────────────
// SPARROW stage due dates as MM-DD, falling in the calendar year AFTER the FY
// starts (period 2025-26 -> 30 Apr 2026 ...). The disclosed stage uses the
// record's own representationDue (15 days from disclosure) instead.
const mmdd = z.string().regex(/^(0[1-9]|1[0-2])-(0[1-9]|[12]\d|3[01])$/, "MM-DD");
export const aparDeadlinesSchema = z.object({
  self_pending:         mmdd.default("04-30"),
  reporting_officer:    mmdd.default("05-31"),
  reviewing_officer:    mmdd.default("06-30"),
  accepting_authority:  mmdd.default("07-31"),
});
export type AparDeadlines = z.infer<typeof aparDeadlinesSchema>;

// ── dashboard_scope (GAP-HR-DASHBOARD-08) ───────────────────────────────────
// What a viewer whose ONLY elevated role is `manager` sees on the HR dashboard:
// 'direct_reports' (default -- headcount/leave inbox limited to their reports,
// matching the employee list they already get) or 'organisation' (the previous
// tenant-wide behaviour, labelled as such).
export const dashboardScopeSchema = z.object({
  managerScope: z.enum(["direct_reports", "organisation"]).default("direct_reports"),
});
export type DashboardScope = z.infer<typeof dashboardScopeSchema>;

export const POLICY_SCHEMAS = {
  wfh_eligibility: wfhEligibilitySchema,
  apar_deadlines: aparDeadlinesSchema,
  dashboard_scope: dashboardScopeSchema,
} as const;

export type PolicyKey = keyof typeof POLICY_SCHEMAS;
export const POLICY_KEYS = Object.keys(POLICY_SCHEMAS) as PolicyKey[];
export type PolicyValue<K extends PolicyKey> = z.infer<(typeof POLICY_SCHEMAS)[K]>;

export function isPolicyKey(k: string): k is PolicyKey {
  return (POLICY_KEYS as string[]).includes(k);
}

/** The effective value for a key: the stored object merged over the defaults ({} == all defaults). */
export function resolvePolicy<K extends PolicyKey>(key: K, stored: unknown): PolicyValue<K> {
  const schema = POLICY_SCHEMAS[key] as z.ZodTypeAny;
  const parsed = schema.safeParse(stored ?? {});
  return (parsed.success ? parsed.data : schema.parse({})) as PolicyValue<K>;
}
