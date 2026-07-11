/**
 * config-registry pure domain — id derivation, namespace/key validation, and
 * the config/metadata keystone for meeting-service ("nothing hardcoded"). No I/O
 * — every function here is deterministic and side-effect free so it is trivially
 * unit-testable and safe to call from both the command and consumer paths.
 *
 * Mirrors court-service/src/modules/config-registry/domain.ts and
 * visitor-service/src/modules/config-registry/domain.ts (the gold-standard
 * template) so call sites port 1:1. The only meeting-specific additions are the
 * POLICY namespace/keys and DEFAULTS table (see policy.ts) that make the service's
 * previously-hardcoded operational knobs (agenda/minutes submission deadlines,
 * committee tenure advance-notice window, action-item escalation windows, …)
 * tenant-configurable.
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

/** meeting config-registry UUIDv5 namespace (distinct from court/visitor registries). */
export const MEETING_NAMESPACE = "b7d2f4a6-1e39-4c85-8a71-3f0c9d5b2e14";

/**
 * A config id is deterministic on (tenantId + namespace + config_key) so
 * re-submitting the SAME (namespace, key) resolves to the SAME id — the write is
 * an idempotent upsert-by-id, and the DB's UNIQUE(tenant, namespace, key) index
 * agrees with the derived primary key.
 */
export function deriveConfigId(tenantId: string, namespace: string, configKey: string): string {
  return deterministicId(MEETING_NAMESPACE, `${tenantId}:config:${namespace}:${configKey}`);
}

/**
 * A namespace is the config domain (e.g. "meeting_policy"). Lowercase snake-ish:
 * starts with a letter, then 1–63 more of [a-z0-9_] (total 2–64 chars, matching
 * the VARCHAR(64) column).
 */
export const NAMESPACE_PATTERN = /^[a-z][a-z0-9_]{1,63}$/;

/**
 * A config key within a namespace. Starts with an alphanumeric, then up to 127
 * more of [A-Za-z0-9._-] (total 1–128 chars, matching the VARCHAR(128) column).
 * Dots are allowed (e.g. "agenda.submission_deadline_days") — routes must not
 * treat keys as path segments.
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
 * The config domains meeting-service drives from this store (documentation of
 * intent, NOT a hard restriction): custom namespaces are allowed so long as they
 * match NAMESPACE_PATTERN. Modules SHOULD read their knobs/rules from these
 * namespaces rather than hardcoding them.
 *
 *   - meeting_policy          — scalar operational knobs (submission-deadline
 *                               windows, tenure advance-notice days, escalation
 *                               windows, default item durations). See
 *                               POLICY_DEFAULTS in policy.ts for the list.
 *   - meeting_committee_types — the effectiveAllowed set of committee body types a
 *                               tenant permits (tenant set REPLACES the default
 *                               {standing, ad_hoc, statutory, board}).
 */
export const KNOWN_NAMESPACES = [
  "meeting_policy",
  "meeting_committee_types",
] as const;
export type KnownNamespace = typeof KNOWN_NAMESPACES[number];

/**
 * Reserved sentinel key expressing an EXPLICITLY EMPTY configured set.
 *
 * `effectiveAllowed` cannot distinguish "the tenant configured nothing" (→ fall
 * back to the module default) from "the tenant deliberately wants the empty set"
 * using key COUNT alone — both surface as zero *meaningful* keys. To let a tenant
 * configure the empty set they add a single active config entry whose key is this
 * sentinel. It is pattern-valid ({@link KEY_PATTERN}) yet is not a real domain
 * value, so it can never collide with a legitimate configured member.
 */
export const CONFIGURED_EMPTY_SENTINEL = "none";

/**
 * Resolve the EFFECTIVE allowed set for a config-driven enumeration.
 * If the tenant has configured ANY active entries for the namespace, that set
 * is AUTHORITATIVE — it fully REPLACES the module defaults, so a tenant can
 * both ADD bespoke values AND RESTRICT to exactly its policy's set. If the
 * tenant configured nothing, the module's built-in defaults apply. Mirrors
 * court/visitor `effectiveAllowed`.
 *
 * Three cases, distinguished so a tenant CAN express the empty set:
 *   - key set is unset (no active entries)      → module `fallback` default.
 *   - key set is exactly/contains the sentinel  → the EXPLICIT empty set (∅).
 *   - any other non-empty key set               → that set (authoritative REPLACE).
 */
export function effectiveAllowed(configuredKeys: string[], fallback: readonly string[]): Set<string> {
  if (configuredKeys.length === 0) return new Set(fallback);
  if (configuredKeys.includes(CONFIGURED_EMPTY_SENTINEL)) return new Set();
  return new Set(configuredKeys);
}
