/**
 * config-registry pure domain — id derivation, namespace/key validation, and
 * the config/metadata keystone for visitor-service ("nothing hardcoded"). No I/O
 * — every function here is deterministic and side-effect free so it is trivially
 * unit-testable and safe to call from both the command and consumer paths.
 *
 * Mirrors court-service/src/modules/config-registry/domain.ts (the gold-standard
 * template) so call sites port 1:1. The only visitor-specific additions are the
 * POLICY namespace/keys and DEFAULTS table (see policy.ts) that make the service's
 * previously-hardcoded operational knobs tenant-configurable.
 */
import { createHash } from "node:crypto";

/** RFC 4122 §4.3 UUIDv5 over a fixed namespace + name → stable, collision-free id. */
export function deterministicId(namespace: string, name: string): string {
  const nsBytes = Buffer.from(namespace.replace(/-/g, ""), "hex");
  const nameBytes = Buffer.from(name, "utf8");
  const hash = createHash("sha1").update(nsBytes).update(nameBytes).digest();
  hash[6] = ((hash[6] ?? 0) & 0x0f) | 0x50; // version 5
  hash[8] = ((hash[8] ?? 0) & 0x3f) | 0x80; // RFC 4122 variant
  const hex = hash.subarray(0, 16).toString("hex");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20, 32)}`;
}

/** visitor config-registry UUIDv5 namespace (distinct from court-registry's). */
export const VISITOR_NAMESPACE = "a1c4e8d2-7b55-4f10-9e33-2d6c7b8a9f02";

/**
 * A config id is deterministic on (tenantId + namespace + config_key) so
 * re-submitting the SAME (namespace, key) resolves to the SAME id — the write is
 * an idempotent upsert-by-id, and the DB's UNIQUE(tenant, namespace, key) index
 * agrees with the derived primary key.
 */
export function deriveConfigId(tenantId: string, namespace: string, configKey: string): string {
  return deterministicId(VISITOR_NAMESPACE, `${tenantId}:config:${namespace}:${configKey}`);
}

/**
 * A namespace is the config domain (e.g. "visitor_policy"). Lowercase snake-ish:
 * starts with a letter, then 1–63 more of [a-z0-9_] (total 2–64 chars, matching
 * the VARCHAR(64) column).
 */
export const NAMESPACE_PATTERN = /^[a-z][a-z0-9_]{1,63}$/;

/**
 * A config key within a namespace. Starts with an alphanumeric, then up to 127
 * more of [A-Za-z0-9._-] (total 1–128 chars, matching the VARCHAR(128) column).
 * Dots are allowed (e.g. "visit_request.reminder_hours") — routes must not treat
 * keys as path segments.
 */
export const KEY_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/;

export function assertValidNamespace(namespace: string): void {
  if (!NAMESPACE_PATTERN.test(namespace)) {
    throw new Error(
      `INVALID_CONFIG_NAMESPACE: '${namespace}' must match ${NAMESPACE_PATTERN.source}`,
    );
  }
}

export function assertValidKey(configKey: string): void {
  if (!KEY_PATTERN.test(configKey)) {
    throw new Error(
      `INVALID_CONFIG_KEY: '${configKey}' must match ${KEY_PATTERN.source}`,
    );
  }
}

/**
 * The config domains visitor-service drives from this store (documentation of
 * intent, NOT a hard restriction): custom namespaces are allowed so long as they
 * match NAMESPACE_PATTERN. Modules SHOULD read their knobs/rules from these
 * namespaces rather than hardcoding them.
 *
 *   - visitor_policy   — scalar operational knobs (retention days, thresholds,
 *                        validity caps, lead-time bounds, tolerances). See
 *                        POLICY_DEFAULTS in policy.ts for the authoritative list.
 *   - visitor_approval — the effectiveAllowed set of auto-approve visitor
 *                        categories (tenant set REPLACES the default {vip}).
 */
export const KNOWN_NAMESPACES = [
  "visitor_policy",
  "visitor_approval",
] as const;
export type KnownNamespace = typeof KNOWN_NAMESPACES[number];

/**
 * Reserved sentinel key expressing an EXPLICITLY EMPTY configured set.
 *
 * `effectiveAllowed` cannot distinguish "the tenant configured nothing" (→ fall
 * back to the module default) from "the tenant deliberately wants the empty set"
 * (→ everyone requires approval / nothing is auto-allowed) using key COUNT alone —
 * both surface as zero *meaningful* keys. To let a tenant configure the empty set
 * (e.g. auto-approve NOBODY), they add a single active config entry whose key is
 * this sentinel. It is pattern-valid ({@link KEY_PATTERN}) yet is not a real
 * domain value, so it can never collide with a legitimate configured member.
 */
export const CONFIGURED_EMPTY_SENTINEL = "none";

/**
 * Resolve the EFFECTIVE allowed set for a config-driven enumeration.
 * If the tenant has configured ANY active entries for the namespace, that set
 * is AUTHORITATIVE — it fully REPLACES the module defaults, so a tenant can
 * both ADD bespoke values AND RESTRICT to exactly its policy's set. If the
 * tenant configured nothing, the module's built-in defaults apply. Mirrors
 * court-service's `effectiveAllowed`.
 *
 * Three cases, distinguished so a tenant CAN express the empty set:
 *   - key set is unset (no active entries)      → module `fallback` default.
 *   - key set is exactly/contains the sentinel  → the EXPLICIT empty set (∅),
 *     i.e. the tenant auto-allows nobody; the default is NOT re-applied.
 *   - any other non-empty key set               → that set (authoritative REPLACE).
 */
export function effectiveAllowed(configuredKeys: string[], fallback: readonly string[]): Set<string> {
  if (configuredKeys.length === 0) return new Set(fallback);
  if (configuredKeys.includes(CONFIGURED_EMPTY_SENTINEL)) return new Set();
  return new Set(configuredKeys);
}

// ─── visitor_policy value bounds ─────────────────────────────────────────────────

/**
 * Inclusive integer bounds for every NUMERIC visitor_policy knob (keys mirror
 * POLICY_DEFAULTS in policy.ts; units are encoded in the key suffix). A value
 * outside its bounds (e.g. retention.pii_days = 999999) is refused at write
 * time rather than silently driving the purge/overstay/lead-time workers.
 * Where the admin UI exposes the field its range matches the web form
 * (apps/web visitor/_data/policy.ts).
 */
export const POLICY_NUMBER_BOUNDS: Readonly<Record<string, { min: number; max: number }>> = {
  "retention.pii_days":                      { min: 1, max: 3650 },
  "retention.erasure_sla_hours":             { min: 1, max: 720 },
  "visit_request.reminder_hours":            { min: 1, max: 720 },
  "visit_request.auto_reject_hours":         { min: 1, max: 720 },
  "visit_request.no_show_warning_minutes":   { min: 1, max: 1440 },
  "visit_request.no_show_hours":             { min: 1, max: 72 },
  "visit_request.min_lead_hours":            { min: 0, max: 720 },
  "visit_request.max_lead_days":             { min: 1, max: 365 },
  "check_in.overstay_escalation_hours":      { min: 1, max: 168 },
  "check_in.overstay_grace_minutes":         { min: 0, max: 240 },
  "check_in.waiting_reminder_minutes":       { min: 1, max: 1440 },
  "check_in.waiting_reminder_upper_minutes": { min: 1, max: 1440 },
  "digital_pass.multi_day_max_days":         { min: 1, max: 90 },
  "digital_pass.recurring_max_days":         { min: 1, max: 730 },
  "turnstile.tailgating_tolerance":          { min: 0, max: 10 },
};

/** Boolean-valued visitor_policy knobs (mirrors POLICY_BOOL_DEFAULTS in policy.ts). */
export const POLICY_BOOLEAN_KEYS: ReadonlySet<string> = new Set([
  "turnstile.anti_passback_enabled",
  "check_in.auto_print_badge",
]);

function unwrapValue(v: unknown): unknown {
  // The readers (policy.ts toNumber/toBoolean) also accept a `{ value: X }` wrapper.
  return v && typeof v === "object" && !Array.isArray(v) && "value" in (v as Record<string, unknown>)
    ? (v as Record<string, unknown>).value
    : v;
}

/** The visitor_policy key registry: every numeric knob plus every boolean knob. */
export function isKnownPolicyKey(configKey: string): boolean {
  return Object.prototype.hasOwnProperty.call(POLICY_NUMBER_BOUNDS, configKey) || POLICY_BOOLEAN_KEYS.has(configKey);
}

/**
 * Validate a visitor_policy entry against the key registry, then its type +
 * bounds. Returns an error message, or null when valid. Q29: a key that is not
 * in the registry is rejected (a typo such as "retention.pii_day" used to be
 * stored silently and never read by any worker).
 */
export function policyValueError(configKey: string, value: unknown): string | null {
  if (!isKnownPolicyKey(configKey)) return `unknown visitor_policy key '${configKey}'`;
  const bounds = POLICY_NUMBER_BOUNDS[configKey];
  if (bounds) {
    const raw = unwrapValue(value);
    const n = typeof raw === "number" ? raw : (typeof raw === "string" && raw.trim() !== "" ? Number(raw) : Number.NaN);
    if (!Number.isInteger(n)) return `${configKey} must be a whole number`;
    if (n < bounds.min || n > bounds.max) return `${configKey} must be between ${bounds.min} and ${bounds.max}`;
    return null;
  }
  if (POLICY_BOOLEAN_KEYS.has(configKey)) {
    const raw = unwrapValue(value);
    if (typeof raw !== "boolean" && raw !== "true" && raw !== "false") return `${configKey} must be true or false`;
  }
  return null;
}
