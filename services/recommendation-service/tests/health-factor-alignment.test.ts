import { describe, it, expect } from "vitest";
import { computeHealthScore as writeScore, validateFactors, type HealthFactors } from "../src/modules/health/domain.js";
import { computeHealthScore as readBreakdown, HEALTH_SIGNAL_NAMES } from "../src/modules/health/scoring-domain.js";

// The recompute WRITE path (health/domain.ts) must persist factors under the
// same names the breakdown READ path (scoring-domain.ts) reads, else a stored
// row reads back as all-zero (UAT /crm/health/[accountId] ~0 scores).
describe("health factor-name alignment (write vs read)", () => {
  const factors: HealthFactors = {
    productUsage: 80, engagement: 60, supportBurden: 90, paymentTimeliness: 70, relationshipDepth: 50,
  };

  it("accepts every KA-004 signal name on the write path", () => {
    expect(validateFactors(factors)).toBeNull();
    expect(Object.keys(factors).sort()).toEqual([...HEALTH_SIGNAL_NAMES].sort());
  });

  it("rejects the legacy RFM names", () => {
    expect(validateFactors({ recency: 50 } as unknown as HealthFactors)).toBe("unknown factor: recency");
  });

  it("score written at recompute equals the breakdown read back from stored factors", () => {
    const stored = writeScore(factors);
    const read = readBreakdown(factors);
    expect(stored).toBe(read.score);
    expect(read.score).toBeGreaterThan(0);
    expect(read.contributingFactors.every((f) => f.value > 0)).toBe(true);
  });
});
