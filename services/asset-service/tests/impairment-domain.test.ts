/**
 * IND-AS 36 impairment domain logic tests.
 * Verifies the structured impairment testing computation.
 */
import { describe, it, expect } from "vitest";
import { runImpairmentTest, computeFVLCD, computeSimpleVIU } from "../src/modules/enterprise/impairment-domain.js";

describe("computeFVLCD", () => {
  it("returns fair value minus disposal costs", () => {
    expect(computeFVLCD(1_000_000n, 50_000n)).toBe(950_000n);
  });

  it("returns null when fair value is null", () => {
    expect(computeFVLCD(null, 50_000n)).toBeNull();
  });

  it("returns 0 when disposal costs exceed fair value", () => {
    expect(computeFVLCD(30_000n, 50_000n)).toBe(0n);
  });

  it("handles zero disposal costs", () => {
    expect(computeFVLCD(500_000n, 0n)).toBe(500_000n);
  });
});

describe("computeSimpleVIU", () => {
  it("computes present value of uniform cash flows", () => {
    // ₹1,00,000/year for 5 years at 10% = ~₹3,79,079
    const viu = computeSimpleVIU(10_000_000n, 1000, 5); // 1000 bps = 10%
    expect(viu).toBeGreaterThan(37_000_000n);
    expect(viu).toBeLessThan(38_000_000n);
  });

  it("returns 0 for zero projection years", () => {
    expect(computeSimpleVIU(10_000_000n, 1000, 0)).toBe(0n);
  });

  it("returns 0 for zero discount rate", () => {
    expect(computeSimpleVIU(10_000_000n, 0, 5)).toBe(0n);
  });
});

describe("runImpairmentTest", () => {
  it("recognises impairment when carrying > recoverable (FVLCD higher)", () => {
    const result = runImpairmentTest({
      carryingAmountMinor: 1_000_000n,
      fairValueMinor: 700_000n,
      disposalCostsMinor: 50_000n,
      valueInUseMinor: 600_000n,
    });
    // FVLCD = 700k - 50k = 650k; VIU = 600k; recoverable = max(650k, 600k) = 650k
    expect(result.recoverableAmountMinor).toBe(650_000n);
    expect(result.impairmentLossMinor).toBe(350_000n); // 1M - 650k
    expect(result.outcome).toBe("impairment_recognised");
    expect(result.newCarryingAmountMinor).toBe(650_000n);
  });

  it("recognises impairment when carrying > recoverable (VIU higher)", () => {
    const result = runImpairmentTest({
      carryingAmountMinor: 1_000_000n,
      fairValueMinor: 500_000n,
      disposalCostsMinor: 50_000n,
      valueInUseMinor: 800_000n,
    });
    // FVLCD = 500k - 50k = 450k; VIU = 800k; recoverable = 800k
    expect(result.recoverableAmountMinor).toBe(800_000n);
    expect(result.impairmentLossMinor).toBe(200_000n);
    expect(result.outcome).toBe("impairment_recognised");
  });

  it("no impairment when carrying <= recoverable", () => {
    const result = runImpairmentTest({
      carryingAmountMinor: 500_000n,
      fairValueMinor: 600_000n,
      disposalCostsMinor: 20_000n,
      valueInUseMinor: 550_000n,
    });
    // FVLCD = 580k; VIU = 550k; recoverable = 580k > carrying 500k
    expect(result.impairmentLossMinor).toBe(0n);
    expect(result.outcome).toBe("no_impairment");
    expect(result.newCarryingAmountMinor).toBe(500_000n);
  });

  it("reverses prior impairment (capped at prior amount)", () => {
    const result = runImpairmentTest({
      carryingAmountMinor: 500_000n, // after prior impairment
      fairValueMinor: 900_000n,
      disposalCostsMinor: 10_000n,
      valueInUseMinor: 800_000n,
      priorImpairmentMinor: 200_000n, // was impaired by 200k before
      unimpairedCarryingMinor: 700_000n, // would have been 700k without impairment
    });
    // Recoverable = max(890k, 800k) = 890k > carrying 500k
    // Reversal candidate = 890k - 500k = 390k
    // But ceiling = 700k (unimpaired) - 500k = 200k
    // And capped at prior impairment = 200k
    // So reversal = min(390k, 200k, 200k) = 200k
    expect(result.outcome).toBe("reversal");
    expect(result.reversalMinor).toBe(200_000n);
    expect(result.newCarryingAmountMinor).toBe(700_000n);
  });

  it("reversal is partial when ceiling limits it", () => {
    const result = runImpairmentTest({
      carryingAmountMinor: 400_000n,
      fairValueMinor: 700_000n,
      disposalCostsMinor: 0n,
      valueInUseMinor: null,
      priorImpairmentMinor: 300_000n,
      unimpairedCarryingMinor: 550_000n,
    });
    // Recoverable = 700k; candidate reversal = 700k - 400k = 300k
    // Ceiling = 550k - 400k = 150k
    // Capped at min(300k, 150k) = 150k (< priorImpairment 300k, so 150k)
    expect(result.outcome).toBe("reversal");
    expect(result.reversalMinor).toBe(150_000n);
    expect(result.newCarryingAmountMinor).toBe(550_000n);
  });

  it("handles case where only VIU is available", () => {
    const result = runImpairmentTest({
      carryingAmountMinor: 800_000n,
      fairValueMinor: null,
      disposalCostsMinor: 0n,
      valueInUseMinor: 600_000n,
    });
    expect(result.recoverableAmountMinor).toBe(600_000n);
    expect(result.impairmentLossMinor).toBe(200_000n);
    expect(result.fvlcdMinor).toBeNull();
  });

  it("handles case where only FVLCD is available", () => {
    const result = runImpairmentTest({
      carryingAmountMinor: 800_000n,
      fairValueMinor: 650_000n,
      disposalCostsMinor: 50_000n,
      valueInUseMinor: null,
    });
    expect(result.recoverableAmountMinor).toBe(600_000n);
    expect(result.impairmentLossMinor).toBe(200_000n);
    expect(result.viuMinor).toBeNull();
  });

  it("returns no_impairment when neither FVLCD nor VIU available", () => {
    const result = runImpairmentTest({
      carryingAmountMinor: 800_000n,
      fairValueMinor: null,
      disposalCostsMinor: 0n,
      valueInUseMinor: null,
    });
    expect(result.outcome).toBe("no_impairment");
    expect(result.impairmentLossMinor).toBe(0n);
    expect(result.newCarryingAmountMinor).toBe(800_000n);
  });

  it("no reversal when no prior impairment exists", () => {
    const result = runImpairmentTest({
      carryingAmountMinor: 500_000n,
      fairValueMinor: 900_000n,
      disposalCostsMinor: 0n,
      valueInUseMinor: 800_000n,
      priorImpairmentMinor: 0n,
    });
    expect(result.outcome).toBe("no_impairment");
    expect(result.reversalMinor).toBe(0n);
  });
});
