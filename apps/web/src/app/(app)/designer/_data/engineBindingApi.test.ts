import { describe, it, expect } from "vitest";
import {
  bindingFromDescriptor,
  normalizeBindingsFromApi,
  newExemptionRow,
} from "./engineBindingApi";
import type { EngineDescriptorUi } from "@/app/_components/ds/designer/engineBindingTypes";
import { hasFeeEngineBinding, percentInputToBps, bpsToPercentInput } from "@/app/_components/ds/designer/engineBindingTypes";

const descriptor: EngineDescriptorUi = {
  engineKey: "revenue.assessment",
  label: "Assessment",
  description: "PT",
  blocks: ["fee", "assessment"],
  available: true,
  configSchema: [],
  defaultConfig: {
    exemptionCategories: [{ code: "SENIOR", label: "Senior", percentBps: 1000 }],
    penaltyPercentBps: 1200,
    rebatePercentBps: 500,
    rebateWindowDays: 30,
    penaltyGraceDays: 15,
    hoaCode: "",
    extras: { businessService: "PT" },
  },
};

describe("engineBindingApi helpers (FN-21)", () => {
  it("normalizes API bindings and uppercases exemption codes", () => {
    const bindings = normalizeBindingsFromApi([
      {
        id: "11111111-1111-4111-8111-111111111111",
        block: "fee",
        engineKey: "revenue.assessment",
        config: {
          exemptionCategories: [{ code: "senior", label: "Senior", percentBps: 1000 }],
          hoaCode: "4100",
        },
      },
      { block: "fee" },
    ]);
    expect(bindings).toHaveLength(1);
    expect(bindings[0]!.config.exemptionCategories[0]!.code).toBe("SENIOR");
    expect(hasFeeEngineBinding(bindings)).toBe(true);
  });

  it("builds a binding from a registry descriptor", () => {
    const b = bindingFromDescriptor(descriptor, "fee");
    expect(b.engineKey).toBe("revenue.assessment");
    expect(b.config.extras.businessService).toBe("PT");
    expect(b.config.exemptionCategories).toHaveLength(1);
  });

  it("converts percent ↔ bps for Studio inputs", () => {
    expect(percentInputToBps("10")).toBe(1000);
    expect(bpsToPercentInput(1500)).toBe("15");
    expect(newExemptionRow().code).toBe("");
  });
});
