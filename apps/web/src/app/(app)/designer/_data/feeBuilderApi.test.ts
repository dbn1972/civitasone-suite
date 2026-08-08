import { describe, expect, it } from "vitest";
import {
  buildSampleCalculation,
  computeFlatFeeLocal,
  computeSlabFeeLocal,
  emptyFeeDesign,
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

  it("previews flat ₹500 with 50% micro exemption as demand lines", () => {
    const design = {
      ...emptyFeeDesign("Trade License"),
      feeModel: "flat" as const,
      baseAmountPaise: 50000,
      hoaCode: "0070",
      exemptions: [
        { id: "e1", attribute: "category", op: "eq" as const, value: "micro", kind: "percent" as const, amount: "50", label: "Micro enterprise" },
      ],
    };
    const calc = buildSampleCalculation(design, { category: "micro" }, 0, "on_time");
    expect(calc.lines[0]?.taxHeadCode).toBe("BASE");
    expect(calc.lines[0]?.amountPaise).toBe(50000);
    expect(calc.lines.some((l) => l.kind === "exemption" && l.amountPaise === -25000)).toBe(true);
    expect(calc.totalPaise).toBe(25000);
    expect(calc.hoaCode).toBe("0070");
  });

  it("applies early rebate and late penalty on sample rail", () => {
    const design = {
      ...emptyFeeDesign("Fee"),
      feeModel: "flat" as const,
      baseAmountPaise: 10000,
      hoaCode: "0029",
      rebateDays: 7,
      rebatePercent: 10,
      penaltyDays: 15,
      penaltyPercent: 5,
    };
    const early = buildSampleCalculation(design, {}, 0, "early");
    expect(early.totalPaise).toBe(9000);
    expect(early.lines.some((l) => l.kind === "rebate")).toBe(true);

    const late = buildSampleCalculation(design, {}, 0, "late");
    expect(late.totalPaise).toBe(10500);
    expect(late.lines.some((l) => l.kind === "penalty")).toBe(true);
  });
});
