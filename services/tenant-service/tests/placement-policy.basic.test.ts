/**
 * Minimal coverage tests for `placement-policy.ts`.
 *
 * This is intentionally NOT the full property test (task 6.2) or the
 * concrete-examples unit test suite (task 6.3) — those are separate,
 * more thorough test tasks planned later in the spec. This file exists
 * only to raise line coverage on the newly added pure module before
 * those dedicated tasks land.
 */
import { describe, it, expect, afterEach, vi } from "vitest";

describe("placement-policy.ts (basic coverage)", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.resetModules();
  });

  it("tierFor returns the mapped tier for an edition present in the config", async () => {
    const { tierFor } = await import("../src/modules/tenant/placement-policy.js");
    const decision = tierFor("govt", {
      version: "2026-07-01",
      mapping: { govt: "silo" },
    });
    expect(decision).toEqual({
      tier: "silo",
      policyVersion: "2026-07-01",
      reason: "policy_mapped",
    });
  });

  it("tierFor falls back to pool for an edition absent from the config's mapping", async () => {
    const { tierFor } = await import("../src/modules/tenant/placement-policy.js");
    const decision = tierFor("small_office", {
      version: "2026-07-01",
      mapping: { govt: "silo" },
    });
    expect(decision).toEqual({
      tier: "pool",
      policyVersion: "2026-07-01",
      reason: "fallback_default",
    });
  });

  it("loadPlacementPolicyConfig parses a valid TENANT_PLACEMENT_POLICY env var at module load", async () => {
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

  it("loadPlacementPolicyConfig falls back to the default config when the env var is unset", async () => {
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

  it("loadPlacementPolicyConfig falls back to the default config on malformed JSON", async () => {
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
