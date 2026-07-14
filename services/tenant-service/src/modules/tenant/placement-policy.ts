/**
 * Tenant_Placement_Policy — pure edition-based Isolation_Tier assignment.
 *
 * Mirrors the env-driven, fail-safe-to-`{}` parsing style of
 * `envShardResolver()` in `packages/db/src/tenant-router.ts`: a small,
 * infrequently-changed, platform-wide config read once from an environment
 * variable at module load, with zero DB round-trips and zero network I/O.
 *
 * `TENANT_PLACEMENT_POLICY` holds a JSON string of the shape:
 *   {"version":"2026-07-01","mapping":{"govt":"silo","psu":"silo"}}
 *
 * Any edition absent from `mapping` (including when the env var is unset or
 * malformed) always falls back to the `pool` tier — this module never throws
 * and never leaves an edition without a defined tier.
 */

export type Edition =
  | "govt"
  | "psu"
  | "private"
  | "ngo"
  | "section8"
  | "cooperative"
  | "small_office";

export type PlacementPolicyConfig = {
  version: string;
  mapping: Partial<Record<Edition, "pool" | "silo">>;
};

export interface PlacementDecision {
  tier: "pool" | "silo";
  policyVersion: string;
  reason: "policy_mapped" | "fallback_default";
}

const DEFAULT_POLICY_VERSION = "unconfigured";

/** Fail-safe default: no mapping overrides, every edition resolves to `pool`. */
const DEFAULT_CONFIG: PlacementPolicyConfig = {
  version: DEFAULT_POLICY_VERSION,
  mapping: {},
};

/**
 * Parse `TENANT_PLACEMENT_POLICY` once. Same fail-safe-to-`{}` pattern as
 * `envShardResolver()`: any missing/malformed JSON, or a malformed `mapping`
 * field, silently falls back to the default (pool-for-everything) config
 * rather than throwing at module load or at request time.
 */
function parsePlacementPolicyConfig(raw: string | undefined): PlacementPolicyConfig {
  if (!raw) return DEFAULT_CONFIG;
  try {
    const parsed = JSON.parse(raw) as Partial<PlacementPolicyConfig>;
    const version =
      typeof parsed.version === "string" && parsed.version.length > 0
        ? parsed.version
        : DEFAULT_POLICY_VERSION;
    const mapping =
      parsed.mapping && typeof parsed.mapping === "object" ? parsed.mapping : {};
    return { version, mapping };
  } catch {
    return DEFAULT_CONFIG;
  }
}

/** Parsed once at module load — mirrors `envShardResolver()`'s module-load parsing. */
const PLACEMENT_POLICY_CONFIG = parsePlacementPolicyConfig(process.env.TENANT_PLACEMENT_POLICY);

/**
 * The effective Tenant_Placement_Policy config, parsed once at module load
 * from `TENANT_PLACEMENT_POLICY`. Callers (e.g. the onboarding pipeline)
 * should use this instead of re-parsing the env var themselves.
 */
export function loadPlacementPolicyConfig(): PlacementPolicyConfig {
  return PLACEMENT_POLICY_CONFIG;
}

/**
 * Pure function: resolve a tenant's initial Isolation_Tier from its edition.
 *
 * - If `config.mapping` has an entry for `edition`, that tier is returned
 *   with `reason: "policy_mapped"` and `policyVersion` equal to `config.version`.
 * - Otherwise (edition unmapped — including when `config` is the fail-safe
 *   default), the `pool` tier is returned with `reason: "fallback_default"`.
 *
 * Total over the fixed `Edition` enum: every edition always yields a decision.
 */
export function tierFor(edition: Edition, config: PlacementPolicyConfig): PlacementDecision {
  const mapped = config.mapping[edition];
  if (mapped) {
    return {
      tier: mapped,
      policyVersion: config.version,
      reason: "policy_mapped",
    };
  }
  return {
    tier: "pool",
    policyVersion: config.version,
    reason: "fallback_default",
  };
}
