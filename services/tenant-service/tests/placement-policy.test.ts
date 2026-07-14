/**
 * Concrete-example unit tests for `placement-policy.ts` (Tenant_Placement_Policy).
 *
 * Supersedes `placement-policy.basic.test.ts` (temporary minimal coverage
 * added before this dedicated task landed). Covers, per the task's
 * acceptance criteria:
 *   - a mapped edition resolving to `silo` (`govt`)
 *   - a second mapped edition resolving to `silo` (`psu`)
 *   - an unmapped edition falling back to `pool` with `reason: fallback_default` (`small_office`)
 *   - a second unmapped edition falling back to `pool` (`ngo`)
 *   - `policyVersion` correctly threaded through from the config into the
 *     returned `PlacementDecision`, for both mapped and fallback outcomes
 *   - `loadPlacementPolicyConfig()` env-parsing behavior (valid/unset/malformed)
 *
 * Validates: Requirements 2.1, 2.5, 2.6
 */
import { describe, it, expect, afterEach, vi } from "vitest";
import { tierFor, type PlacementPolicyConfig } from "../src/modules/tenant/placement-policy.js";

describe("placement-policy.ts — tierFor concrete examples", () => {
  const configWithMappings: PlacementPolicyConfig = {
    version: "2026-07-01",
    mapping: { govt: "silo", psu: "silo" },
  };

  it("maps `govt` edition to the `silo` tier with reason `policy_mapped`", () => {
    const decision = tierFor("govt", configWithMappings);
    expect(decision).toEqual({
      tier: "silo",
      policyVersion: "2026-07-01",
      reason: "policy_mapped",
    });
  });

  it("maps `psu` edition to the `silo` tier with reason `policy_mapped`", () => {
    const decision = tierFor("psu", configWithMappings);
    expect(decision).toEqual({
      tier: "silo",
      policyVersion: "2026-07-01",
      reason: "policy_mapped",
    });
  });

  it("falls back `small_office` (unmapped) to the `pool` tier with reason `fallback_default`", () => {
    const decision = tierFor("small_office", configWithMappings);
    expect(decision).toEqual({
      tier: "pool",
      policyVersion: "2026-07-01",
      reason: "fallback_default",
    });
  });

  it("falls back `ngo` (unmapped) to the `pool` tier with reason `fallback_default`", () => {
    const decision = tierFor("ngo", configWithMappings);
    expect(decision).toEqual({
      tier: "pool",
      policyVersion: "2026-07-01",
      reason: "fallback_default",
    });
  });

  it("falls back every edition to `pool` when the config has no mapping overrides at all", () => {
    const emptyConfig: PlacementPolicyConfig = { version: "unconfigured", mapping: {} };
    expect(tierFor("govt", emptyConfig)).toEqual({
      tier: "pool",
      policyVersion: "unconfigured",
      reason: "fallback_default",
    });
    expect(tierFor("small_office", emptyConfig)).toEqual({
      tier: "pool",
      policyVersion: "unconfigured",
      reason: "fallback_default",
    });
  });

  it("threads `policyVersion` from the config into a `policy_mapped` decision", () => {
    const decision = tierFor("govt", {
      version: "2027-01-15",
      mapping: { govt: "silo" },
    });
    expect(decision.policyVersion).toBe("2027-01-15");
    expect(decision.reason).toBe("policy_mapped");
  });

  it("threads `policyVersion` from the config into a `fallback_default` decision", () => {
    const decision = tierFor("small_office", {
      version: "2027-01-15",
      mapping: { govt: "silo" },
    });
    expect(decision.policyVersion).toBe("2027-01-15");
    expect(decision.reason).toBe("fallback_default");
  });
});

describe("placement-policy.ts — loadPlacementPolicyConfig env parsing", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.resetModules();
  });

  it("parses a valid TENANT_PLACEMENT_POLICY env var at module load", async () => {
    vi.resetModules();
    vi.stubEnv(
      "TENANT_PLACEMENT_POLICY",
      JSON.stringify({ version: "2026-08-01", mapping: { psu: "silo" } }),
    );
    const { loadPlacementPolicyConfig } = await import(
      "../src/modules/tenant/placement-policy.js"
    );
    expect(loadPlacementPolicyConfig()).toEqual({
      version: "2026-08-01",
      mapping: { psu: "silo" },
    });
  });

  it("falls back to the default config when the env var is unset", async () => {
    vi.resetModules();
    vi.stubEnv("TENANT_PLACEMENT_POLICY", "");
    const { loadPlacementPolicyConfig } = await import(
      "../src/modules/tenant/placement-policy.js"
    );
    expect(loadPlacementPolicyConfig()).toEqual({
      version: "unconfigured",
      mapping: {},
    });
  });

  it("falls back to the default config on malformed JSON", async () => {
    vi.resetModules();
    vi.stubEnv("TENANT_PLACEMENT_POLICY", "{not valid json");
    const { loadPlacementPolicyConfig } = await import(
      "../src/modules/tenant/placement-policy.js"
    );
    expect(loadPlacementPolicyConfig()).toEqual({
      version: "unconfigured",
      mapping: {},
    });
  });
});
