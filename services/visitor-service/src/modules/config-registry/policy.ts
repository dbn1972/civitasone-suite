/**
 * config-registry — typed policy getters.
 *
 * This is the "consumer of config" layer: the previously-hardcoded operational
 * knobs of visitor-service, each mapped to a (namespace, key) with the CURRENT
 * literal as its documented DEFAULT. Every getter returns the tenant's configured
 * value when present and the default otherwise, so behavior is IDENTICAL for a
 * tenant that has configured nothing — the migration is behavior-preserving.
 *
 * Two read paths (mirroring court-service):
 *   - HTTP / consumer path — `getPolicyNumber(tx, tenant, key)` etc. resolve one
 *     value on the caller's GUC-scoped `tx` via repo.getConfigValueOnTx.
 *   - Worker path — the maintenance workers load a whole namespace's overrides
 *     once per cycle with repo.loadNamespaceOverrides (cross-tenant, BYPASSRLS),
 *     then resolve per-candidate with `resolveNumber(overrides, tenant, key)`.
 *
 * DURATIONS are stored in human units (days / hours / minutes) and converted to
 * ms by the *_MS helpers, so an admin sets `retention.pii_days = 30`, not a raw
 * millisecond count.
 */
import type { Writer } from "./repo.js";
import { getConfigValueOnTx, listActiveKeys } from "./repo.js";
import { effectiveAllowed } from "./domain.js";

/** Namespace for scalar operational knobs. */
export const POLICY_NS = "visitor_policy";
/** Namespace for the effectiveAllowed set of auto-approve visitor categories. */
export const APPROVAL_NS = "visitor_approval";

/**
 * The authoritative config-key → default table. The default is the literal that
 * was hardcoded before this migration; overriding a key changes behavior for that
 * tenant ONLY. Units are encoded in the key suffix (_days / _hours / _minutes).
 */
export const POLICY_DEFAULTS = {
  // DPDP retention + right-to-erasure (dpdp/purge-worker.ts).
  "retention.pii_days":                    365,
  "retention.erasure_sla_hours":           72,
  // Visit-request pending-approval lifecycle (visit-request/auto-reject-worker.ts).
  "visit_request.reminder_hours":          4,
  "visit_request.auto_reject_hours":       24,
  // No-show detection (visit-request/no-show-worker.ts).
  "visit_request.no_show_warning_minutes": 30,
  "visit_request.no_show_hours":           2,
  // Visit lead-time window (visit-request/domain.ts isValidScheduledDate).
  "visit_request.min_lead_hours":          1,
  "visit_request.max_lead_days":           30,
  // Check-in / overstay (check-in/overstay-worker.ts, check-in/domain.ts).
  "check_in.overstay_escalation_hours":    2,
  "check_in.overstay_grace_minutes":       0,
  // Waiting-in-lobby reminder window (check-in/waiting-reminder-worker.ts).
  "check_in.waiting_reminder_minutes":     10,
  "check_in.waiting_reminder_upper_minutes": 15,
  // Digital-pass validity caps (digital-pass/domain.ts computeValidityWindow).
  "digital_pass.multi_day_max_days":       7,
  "digital_pass.recurring_max_days":       90,
  // Turnstile tolerances (turnstile-control/domain.ts).
  "turnstile.tailgating_tolerance":        1,
} as const;

/** Boolean-valued policy keys (kept separate so the number getters stay total). */
export const POLICY_BOOL_DEFAULTS = {
  "turnstile.anti_passback_enabled":       true,
} as const;

export type PolicyNumberKey = keyof typeof POLICY_DEFAULTS;
export type PolicyBoolKey = keyof typeof POLICY_BOOL_DEFAULTS;

/** Default set of visitor categories that bypass approval (approved on create). */
export const DEFAULT_AUTO_APPROVE_CATEGORIES: readonly string[] = ["vip"];

// ─── Coercion (defensive — a config value is arbitrary JSON) ─────────────────────

/** Coerce an arbitrary JSON config value to a finite number, else `undefined`. */
export function toNumber(v: unknown): number | undefined {
  if (typeof v === "number" && Number.isFinite(v)) return v;
  if (typeof v === "string" && v.trim() !== "" && Number.isFinite(Number(v))) return Number(v);
  // Support the wrapped `{ value: N }` shape some admins may send.
  if (v && typeof v === "object" && "value" in (v as Record<string, unknown>)) {
    return toNumber((v as Record<string, unknown>).value);
  }
  return undefined;
}

/** Coerce an arbitrary JSON config value to a boolean, else `undefined`. */
export function toBoolean(v: unknown): boolean | undefined {
  if (typeof v === "boolean") return v;
  if (v === "true") return true;
  if (v === "false") return false;
  if (v && typeof v === "object" && "value" in (v as Record<string, unknown>)) {
    return toBoolean((v as Record<string, unknown>).value);
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

/** Resolve a boolean policy value for `tenant` from a loaded override map + default. */
export function resolveBoolean(
  overrides: Map<string, Map<string, unknown>>, tenant: string, key: PolicyBoolKey,
): boolean {
  const b = toBoolean(overrides.get(tenant)?.get(key));
  return b ?? POLICY_BOOL_DEFAULTS[key];
}

/**
 * The widest ("most eligible") threshold in ms across the default and every
 * tenant override for a duration key — i.e. the SMALLEST value. A cross-tenant
 * scan that uses this cutoff is guaranteed to surface every tenant's eligible
 * rows; the per-candidate re-check then applies each tenant's own threshold.
 */
export function minThresholdMs(
  overrides: Map<string, Map<string, unknown>>, key: PolicyNumberKey, unitMs: number,
): number {
  let min = POLICY_DEFAULTS[key] * unitMs;
  for (const m of overrides.values()) {
    const n = toNumber(m.get(key));
    if (n !== undefined) min = Math.min(min, n * unitMs);
  }
  return min;
}

// ─── HTTP / consumer path: resolve one value on a GUC-scoped tx ───────────────────

export async function getPolicyNumber(
  tx: Writer, tenantId: string, key: PolicyNumberKey,
): Promise<number> {
  const raw = await getConfigValueOnTx(tx, tenantId, POLICY_NS, key);
  return toNumber(raw) ?? POLICY_DEFAULTS[key];
}

export async function getPolicyBoolean(
  tx: Writer, tenantId: string, key: PolicyBoolKey,
): Promise<boolean> {
  const raw = await getConfigValueOnTx(tx, tenantId, POLICY_NS, key);
  return toBoolean(raw) ?? POLICY_BOOL_DEFAULTS[key];
}

/**
 * The tenant's effective auto-approve visitor categories (effectiveAllowed):
 * the set of active keys in the `visitor_approval` namespace REPLACES the
 * default {vip} when the tenant has configured any; otherwise the default
 * applies. A visitor whose category is in this set bypasses the approval queue.
 */
export async function getAutoApproveCategories(
  tx: Writer, tenantId: string,
): Promise<Set<string>> {
  const keys = await listActiveKeys(tx, tenantId, APPROVAL_NS);
  return effectiveAllowed(keys, DEFAULT_AUTO_APPROVE_CATEGORIES);
}

// ─── Unit → ms conversions (kept here so call sites read declaratively) ───────────

export const MS_PER_MINUTE = 60_000;
export const MS_PER_HOUR = 60 * MS_PER_MINUTE;
export const MS_PER_DAY = 24 * MS_PER_HOUR;
