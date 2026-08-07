import { describe, expect, it } from "vitest";
import {
  computeFlatFeeLocal,
  computeSlabFeeLocal,
  exemptionsUiToApi,
  rupeesInputToPaise,
} from "./feeBuilderApi";
import type { FeeExemptionUi, SlabRowUi } from "@/app/_components/ds/designer/feeTypes";

describe("feeBuilderApi", () => {
  it("converts rupees input to paise safely", () => {
    expect(rupeesInputToPaise("500")).toBe(50000);
    expect(rupeesInputToPaise("500.50")).toBe(50050);
    expect(rupeesInputToPaise("")).toBe(0);
  });

  it("maps exemptions to API shape", () => {
    const exemptions: FeeExemptionUi[] = [
      { id: "e1", attribute: "category", op: "eq", value: "micro", kind: "percent", amount: "50", label: "Micro enterprise" },
    ];
    const api = exemptionsUiToApi(exemptions);
    expect(api[0]?.kind).toBe("percent");
    expect(api[0]?.amount).toBe(50);
  });

  it("computes flat fee with 50% exemption", () => {
    const exemptions: FeeExemptionUi[] = [
      { id: "e1", attribute: "category", op: "eq", value: "micro", kind: "percent", amount: "50", label: "Micro" },
    ];
    const full = computeFlatFeeLocal(50000, exemptions, { category: "other" });
    expect(full.amount).toBe(50000);
    const half = computeFlatFeeLocal(50000, exemptions, { category: "micro" });
    expect(half.amount).toBe(25000);
    expect(half.exemptionLabel).toBe("Micro");
  });

  it("computes slab flat rate", () => {
    const slabs: SlabRowUi[] = [
      { id: "s1", from: "", to: "", rate: "75000", type: "flat" },
    ];
    expect(computeSlabFeeLocal(slabs, 999)).toBe(75000);
  });

  it("computes ad-valorem slab", () => {
    const slabs: SlabRowUi[] = [
      { id: "s1", from: "", to: "", rate: "500", type: "ad_valorem" },
    ];
    expect(computeSlabFeeLocal(slabs, 100000)).toBe(5000);
  });
});
