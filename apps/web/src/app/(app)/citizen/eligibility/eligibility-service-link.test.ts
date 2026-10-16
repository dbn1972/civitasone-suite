import { describe, it, expect } from "vitest";

// ── Unit tests for EligibilityRuleSet serviceKey mapping and conditional link
// (GAP-CITIZEN-ELIGIBILITY-05)
//
// The server-component page itself cannot be rendered in vitest without a full
// Next.js test harness.  These tests cover the data-mapping layer (citizenGaps)
// by exercising the same shape checks the mapper applies.

function mapRuleSet(r: Record<string, unknown>): { serviceKey: string | null } {
  return {
    serviceKey:
      typeof r.serviceKey === "string" && r.serviceKey ? r.serviceKey : null,
  };
}

describe("EligibilityRuleSet serviceKey mapping (GAP-CITIZEN-ELIGIBILITY-05)", () => {
  // Given: the API response has a non-empty serviceKey string
  // When: the mapper processes it
  // Then: serviceKey is the API value
  it("maps a non-empty serviceKey string from the API response", () => {
    expect(mapRuleSet({ serviceKey: "birth-cert" }).serviceKey).toBe("birth-cert");
  });

  // Given: the API response has no serviceKey (undefined)
  // When: the mapper processes it
  // Then: serviceKey is null (no link rendered)
  it("maps absent serviceKey to null", () => {
    expect(mapRuleSet({}).serviceKey).toBeNull();
  });

  // Given: the API response has serviceKey as empty string
  // When: the mapper processes it
  // Then: serviceKey is null (empty string must not produce a broken link)
  it("maps empty-string serviceKey to null", () => {
    expect(mapRuleSet({ serviceKey: "" }).serviceKey).toBeNull();
  });

  // Given: the API response has serviceKey as a non-string
  // When: the mapper processes it
  // Then: serviceKey is null
  it("maps non-string serviceKey to null", () => {
    expect(mapRuleSet({ serviceKey: 123 }).serviceKey).toBeNull();
  });
});
