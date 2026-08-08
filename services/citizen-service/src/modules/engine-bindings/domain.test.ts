import { describe, it, expect } from "vitest";
import {
  assertBindingsPublishable,
  defaultBindingForEngine,
  hasLiveFeeEngineBinding,
  normalizeEngineBindings,
  previewEngineDemand,
} from "./domain.js";

describe("FN-21 engine bindings domain", () => {
  it("normalises valid bindings and drops unknown engines", () => {
    const bindings = normalizeEngineBindings([
      {
        id: "11111111-1111-4111-8111-111111111111",
        block: "fee",
        engineKey: "revenue.assessment",
        config: {
          exemptionCategories: [{ code: "senior", label: "Senior", percentBps: 1000 }],
          hoaCode: "4100",
        },
        requiredForPublish: true,
      },
      { block: "fee", engineKey: "not.a.real.engine", config: {} },
    ]);
    expect(bindings).toHaveLength(1);
    expect(bindings[0]!.engineKey).toBe("revenue.assessment");
    expect(bindings[0]!.config.exemptionCategories[0]!.code).toBe("SENIOR");
    expect(bindings[0]!.config.hoaCode).toBe("4100");
  });

  it("hasLiveFeeEngineBinding is true for available fee engines", () => {
    const live = defaultBindingForEngine("revenue.assessment", "fee");
    expect(hasLiveFeeEngineBinding([live])).toBe(true);
    const stub = defaultBindingForEngine("police.verification", "verification");
    expect(hasLiveFeeEngineBinding([stub])).toBe(false);
  });

  it("assertBindingsPublishable rejects unavailable required engines", () => {
    const stub = defaultBindingForEngine("police.verification", "verification");
    expect(() => assertBindingsPublishable([stub])).toThrow(/ENGINE_UNAVAILABLE/);
  });

  it("assertBindingsPublishable requires HOA for fee bindings", () => {
    const binding = defaultBindingForEngine("revenue.assessment", "fee");
    binding.config.hoaCode = "";
    expect(() => assertBindingsPublishable([binding])).toThrow("ENGINE_HOA_REQUIRED");
    binding.config.hoaCode = "4201";
    expect(() => assertBindingsPublishable([binding])).not.toThrow();
  });

  it("preview applies exemption categories from Studio parameters", () => {
    const binding = defaultBindingForEngine("revenue.assessment", "fee");
    binding.config.hoaCode = "4201";
    binding.config.exemptionCategories = [
      { code: "SENIOR", label: "Senior citizen", percentBps: 1000 },
    ];
    binding.config.rebatePercentBps = 500;
    binding.config.rebateWindowDays = 30;

    const without = previewEngineDemand({
      binding,
      basePrincipalMinor: 100_000,
      selectedExemptions: [],
    });
    expect(without.totalMinor).toBe(100_000);

    const withExempt = previewEngineDemand({
      binding,
      basePrincipalMinor: 100_000,
      selectedExemptions: ["SENIOR"],
      applyRebate: true,
    });
    // 10% exemption → 90_000, then 5% rebate → 85_500
    expect(withExempt.appliedExemptions).toEqual(["SENIOR"]);
    expect(withExempt.totalMinor).toBe(85_500);
    expect(withExempt.lines.some((l) => l.taxHeadCode === "EXEMPTION")).toBe(true);
    expect(withExempt.note).toMatch(/assessment compute remains/i);
  });

  it("preview fails honestly when engine is stubbed", () => {
    const binding = defaultBindingForEngine("crs.birth-death", "fee");
    const result = previewEngineDemand({ binding, basePrincipalMinor: 50_000 });
    expect(result.available).toBe(false);
    expect(result.totalMinor).toBe(0);
    expect(result.note.length).toBeGreaterThan(0);
  });
});
