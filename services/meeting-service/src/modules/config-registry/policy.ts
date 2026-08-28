/**
 * config-registry — typed policy getters.
 *
 * The "consumer of config" layer: the previously-hardcoded operational knobs of
 * meeting-service, each mapped to a (namespace, key) with the CURRENT literal as
 * its documented DEFAULT. Every getter returns the tenant's configured value when
 * present and the default otherwise, so behavior is IDENTICAL for a tenant that
 * has configured nothing — the migration is behavior-preserving.
 *
 * Two read paths (mirroring court/visitor):
 *   - HTTP / consumer path — `getPolicyNumber(tx, tenant, key)` resolves one value
 *     on the caller's GUC-scoped `tx` via repo.getConfigValueOnTx.
 *   - Worker path — the maintenance workers load a whole namespace's overrides once
 *     per cycle with repo.loadNamespaceOverrides (cross-tenant, BYPASSRLS), then
 *     resolve per-candidate with `resolveNumber(overrides, tenant, key)`.
 */
import type { Writer } from "./repo.js";
import { getConfigValueOnTx, listActiveKeys } from "./repo.js";
import { effectiveAllowed } from "./domain.js";

/** Namespace for scalar operational knobs. */
export const POLICY_NS = "meeting_policy";
/** Namespace for the effectiveAllowed set of tenant-permitted committee types. */
export const COMMITTEE_TYPES_NS = "meeting_committee_types";

/**
 * The authoritative config-key → default table. The default is the literal that
 * was hardcoded before this migration; overriding a key changes behavior for that
 * tenant ONLY. Units are encoded in the key suffix (_days / _hours / _minutes).
 *
 * Provenance of each default (grep-verified against the current source):
 *   agenda.submission_deadline_days        → agenda/domain.ts DEFAULT_SUBMISSION_DEADLINE_DAYS = 7
 *   agenda.default_item_duration_minutes   → agenda/domain.ts carry-forward `?? 15`
 *   minutes.submission_deadline_days       → minutes/domain.ts DEFAULT_MINUTES_SUBMISSION_DEADLINE_DAYS = 7
 *   minutes.deadline_alert_lead_days       → minutes/domain.ts MINUTES_DEADLINE_ALERT_LEAD_DAYS = 2
 *   committee.tenure_advance_notice_days   → workers/tenure-expiry.ts DEFAULT_ADVANCE_NOTICE_DAYS = 30
 *   action_item.escalation_l1_hours        → action-item/domain.ts DEFAULT_ESCALATION_CHAIN L1 = 24
 *   action_item.escalation_l2_hours        → action-item/domain.ts DEFAULT_ESCALATION_CHAIN L2 = 72
 *   action_item.escalation_l3_hours        → action-item/domain.ts DEFAULT_ESCALATION_CHAIN L3 = 24*7 = 168
 */
export const POLICY_DEFAULTS = {
  "agenda.submission_deadline_days":      7,
  "agenda.default_item_duration_minutes": 15,
  "minutes.submission_deadline_days":     7,
  "minutes.deadline_alert_lead_days":     2,
  "committee.tenure_advance_notice_days": 30,
  "action_item.escalation_l1_hours":      24,
  "action_item.escalation_l2_hours":      72,
  "action_item.escalation_l3_hours":      168,
  "meeting.notice_period_days":           0,
  "meeting.agenda_circulation_lead_days": 0,
} as const;

export type PolicyNumberKey = keyof typeof POLICY_DEFAULTS;

/** Default committee body types (mirrors committee/domain.ts COMMITTEE_TYPES). */
export const DEFAULT_COMMITTEE_TYPES: readonly string[] = ["standing", "ad_hoc", "statutory", "board"];

// ─── Coercion (defensive — a config value is arbitrary JSON) ─────────────────────

/** Coerce an arbitrary JSON config value to a finite number, else `undefined`. */
export function toNumber(v: unknown): number | undefined {
  if (typeof v === "number" && Number.isFinite(v)) return v;
  if (typeof v === "string" && v.trim() !== "" && Number.isFinite(Number(v))) return Number(v);
  if (v && typeof v === "object" && "value" in (v as Record<string, unknown>)) {
    return toNumber((v as Record<string, unknown>).value);
  }
  return undefined;
}

// ─── Worker path: resolve from a pre-loaded cross-tenant override map ─────────────

/** Resolve a numeric policy value for `tenant` from a loaded override map + default. */
export function resolveNumber(
  overrides: Map<string, Map<string, unknown>>, tenant: string, key: PolicyNumberKey,
): number {
  const n = toNumber(overrides.get(tenant)?.get(key));
  return n ?? POLICY_DEFAULTS[key];
}

/**
 * The action-item escalation chain resolved for `tenant` from a loaded override
 * map. Mirrors action-item/domain.ts DEFAULT_ESCALATION_CHAIN shape so the worker
 * passes the result straight into the pure domain planner. Each rung's window
 * falls back to its literal default when the tenant has not configured it.
 */
export interface ResolvedEscalationRung {
  level: 1 | 2 | 3;
  afterDeadlineHours: number;
  notify: "supervisor" | "department_head" | "chairperson";
}

export function resolveEscalationChain(
  overrides: Map<string, Map<string, unknown>>, tenant: string,
): ResolvedEscalationRung[] {
  return [
    { level: 1, afterDeadlineHours: resolveNumber(overrides, tenant, "action_item.escalation_l1_hours"), notify: "supervisor" },
    { level: 2, afterDeadlineHours: resolveNumber(overrides, tenant, "action_item.escalation_l2_hours"), notify: "department_head" },
    { level: 3, afterDeadlineHours: resolveNumber(overrides, tenant, "action_item.escalation_l3_hours"), notify: "chairperson" },
  ];
}

// ─── HTTP / consumer path: resolve one value on a GUC-scoped tx ───────────────────

export async function getPolicyNumber(
  tx: Writer, tenantId: string, key: PolicyNumberKey,
): Promise<number> {
  const raw = await getConfigValueOnTx(tx, tenantId, POLICY_NS, key);
  return toNumber(raw) ?? POLICY_DEFAULTS[key];
}

/**
 * The tenant's action-item escalation chain resolved on a GUC-scoped `tx` — the
 * consumer / HTTP-path sibling of `resolveEscalationChain` (which resolves from the
 * worker's pre-loaded cross-tenant override map). It builds the IDENTICAL three-rung
 * shape from per-key `getPolicyNumber` reads, each rung's window falling back to its
 * literal default when the tenant has not configured it, and is passed straight into
 * the action-item domain planner (`nextEscalationAt`).
 *
 * Its purpose is symmetry with the worker: `action-item/consumer.ts` seeds the FIRST
 * `next_escalation_at` trigger (on assignment and on a deadline change), and without
 * this it seeded that trigger from the hardcoded DEFAULT_ESCALATION_CHAIN, so a tenant
 * with a shorter-than-default L1 window had its first escalation anchored to the
 * default clock. The worker already re-anchors subsequent rungs per-tenant; this closes
 * the same gap for the first one.
 */
export async function getEscalationChain(
  tx: Writer, tenantId: string,
): Promise<ResolvedEscalationRung[]> {
  // Sequential (not Promise.all): these three reads share one GUC-scoped connection, and
  // getConfigValueOnTx is read-through cached, so the cost is negligible.
  const l1 = await getPolicyNumber(tx, tenantId, "action_item.escalation_l1_hours");
  const l2 = await getPolicyNumber(tx, tenantId, "action_item.escalation_l2_hours");
  const l3 = await getPolicyNumber(tx, tenantId, "action_item.escalation_l3_hours");
  return [
    { level: 1, afterDeadlineHours: l1, notify: "supervisor" },
    { level: 2, afterDeadlineHours: l2, notify: "department_head" },
    { level: 3, afterDeadlineHours: l3, notify: "chairperson" },
  ];
}

/**
 * The tenant's effective set of permitted committee body types (effectiveAllowed):
 * the set of active keys in the `meeting_committee_types` namespace REPLACES the
 * default {standing, ad_hoc, statutory, board} when the tenant has configured any;
 * otherwise the default applies. Wired as an ADDITIVE guard in the committee
 * consumer — unconfigured ⇒ full default set ⇒ identical behavior.
 */
export async function getAllowedCommitteeTypes(
  tx: Writer, tenantId: string,
): Promise<Set<string>> {
  const keys = await listActiveKeys(tx, tenantId, COMMITTEE_TYPES_NS);
  return effectiveAllowed(keys, DEFAULT_COMMITTEE_TYPES);
}


// ─── Boolean / string policy knobs (governance toggles) ──────────────────────────

/**
 * Boolean governance toggles, each with its behavior-preserving default. `voting.weighted_enabled`
 * gates weighted voting (default OFF → 1 member = 1 vote); `quorum.recheck_on_resume` re-verifies
 * quorum live when a meeting resumes after an adjournment (default ON).
 */
export const POLICY_BOOL_DEFAULTS = {
  "voting.weighted_enabled":   false,
  "quorum.recheck_on_resume":  true,
} as const;
export type PolicyBoolKey = keyof typeof POLICY_BOOL_DEFAULTS;

/** Coerce an arbitrary JSON config value to a boolean, else `undefined`. */
export function toBool(v: unknown): boolean | undefined {
  if (typeof v === "boolean") return v;
  if (typeof v === "number") return v !== 0;
  if (typeof v === "string") {
    const t = v.trim().toLowerCase();
    if (t === "true" || t === "1" || t === "yes" || t === "on") return true;
    if (t === "false" || t === "0" || t === "no" || t === "off") return false;
  }
  if (v && typeof v === "object" && "value" in (v as Record<string, unknown>)) {
    return toBool((v as Record<string, unknown>).value);
  }
  return undefined;
}

/** Resolve a boolean policy value on a GUC-scoped tx (default when unconfigured). */
export async function getPolicyBool(
  tx: Writer, tenantId: string, key: PolicyBoolKey,
): Promise<boolean> {
  const raw = await getConfigValueOnTx(tx, tenantId, POLICY_NS, key);
  return toBool(raw) ?? POLICY_BOOL_DEFAULTS[key];
}

/**
 * String governance knobs. `voting.default_threshold` is the majority rule applied to a vote when
 * the initiator does not specify one (default `simple_majority`). `meeting.tenant_timezone` is the
 * tenant's UTC offset (`±HH:MM`, same representation as the plain-meeting `scheduledAt` request
 * field) used to convert a recurring series' bare `HH:MM` `time_of_day` into an absolute instant
 * (meeting-core/consumer.ts `toScheduledAt`) — default `"+00:00"` so a tenant that has configured
 * nothing keeps the PRE-EXISTING (if unintended) UTC interpretation exactly, per this file's
 * behavior-preserving-default rule; a tenant sets its real offset (e.g. `"+05:30"` for IST) once
 * to get series instances scheduled at their intended local wall-clock time.
 */
export const POLICY_STRING_DEFAULTS = {
  "voting.default_threshold": "simple_majority",
  "meeting.tenant_timezone":  "+00:00",
} as const;
export type PolicyStringKey = keyof typeof POLICY_STRING_DEFAULTS;

/** Coerce an arbitrary JSON config value to a non-empty string, else `undefined`. */
export function toStringValue(v: unknown): string | undefined {
  if (typeof v === "string" && v.trim() !== "") return v.trim();
  if (typeof v === "number" || typeof v === "boolean") return String(v);
  if (v && typeof v === "object" && "value" in (v as Record<string, unknown>)) {
    return toStringValue((v as Record<string, unknown>).value);
  }
  return undefined;
}

/** Resolve a string policy value on a GUC-scoped tx (default when unconfigured). */
export async function getPolicyString(
  tx: Writer, tenantId: string, key: PolicyStringKey,
): Promise<string> {
  const raw = await getConfigValueOnTx(tx, tenantId, POLICY_NS, key);
  return toStringValue(raw) ?? POLICY_STRING_DEFAULTS[key];
}
