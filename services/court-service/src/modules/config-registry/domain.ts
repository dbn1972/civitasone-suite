/**
 * config-registry pure domain — id derivation and namespace/key validation for
 * the §47 config/metadata engine. No I/O — every function here is deterministic
 * and side-effect free so it is trivially unit-testable and safe to call from
 * both the command and consumer paths.
 */
import { deterministicId, COURT_NAMESPACE } from "../court-registry/domain.js";

/**
 * A config id is deterministic on (tenantId + namespace + config_key) so
 * re-submitting the SAME (namespace, key) resolves to the SAME id — the write is
 * an idempotent upsert-by-id, and the DB's UNIQUE(tenant, namespace, key) index
 * agrees with the derived primary key.
 */
export function deriveConfigId(tenantId: string, namespace: string, configKey: string): string {
  return deterministicId(COURT_NAMESPACE, `${tenantId}:config:${namespace}:${configKey}`);
}

/**
 * A namespace is the config domain (e.g. "court_type"). Lowercase snake-ish:
 * starts with a letter, then 1–63 more of [a-z0-9_] (total 2–64 chars, matching
 * the VARCHAR(64) column).
 */
export const NAMESPACE_PATTERN = /^[a-z][a-z0-9_]{1,63}$/;

/**
 * A config key within a namespace. Starts with an alphanumeric, then up to 127
 * more of [A-Za-z0-9._-] (total 1–128 chars, matching the VARCHAR(128) column).
 * Dots are allowed (e.g. "fee.filing.civil") — routes must not treat keys as
 * path segments.
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
 * The initial config domains the platform intends to drive from this store
 * (documentation of intent, NOT a hard restriction): custom namespaces are
 * allowed so long as they match NAMESPACE_PATTERN. Modules SHOULD read their
 * enums/rules from these namespaces rather than hardcoding them (§47).
 */
export const KNOWN_NAMESPACES = [
  "court_type",
  "case_type",
  "order_type",
  "hearing_purpose",
  "party_role",
  "evidence_type",
  "fee_schedule",
  "sla_timer",
  "notice_template",
] as const;
export type KnownNamespace = typeof KNOWN_NAMESPACES[number];
