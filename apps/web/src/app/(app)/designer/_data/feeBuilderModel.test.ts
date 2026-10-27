import { describe, expect, it } from "vitest";
import type { FeeDesignState, FeeExemptionUi } from "@/app/_components/ds/designer/feeTypes";
import {
  filterHoaOptions,
  hoaBlockMessage,
  isFeeBlocking,
  isFeeDesignReadyToAdvance,
  isHoaBlocking,
  suggestExemptSampleValues,
  suggestFullFeeSampleValues,
} from "./feeBuilderModel";
import { emptyFeeDesign } from "./feeBuilderApi";

function baseDesign(patch: Partial<FeeDesignState> = {}): FeeDesignState {
  return { ...emptyFeeDesign("Trade License"), feeModel: "flat", baseAmountPaise: 50000, ...patch };
}

describe("feeBuilderModel", () => {
  it("filters HOA options by code or label", () => {
    const opts = [
      { code: "0029", label: "0029 — Land Revenue" },
      { code: "0070", label: "0070 — Other Administrative Services" },
    ];
    expect(filterHoaOptions(opts, "70")).toHaveLength(1);
    expect(filterHoaOptions(opts, "land")).toHaveLength(1);
    expect(filterHoaOptions(opts, "")).toHaveLength(2);
  });

  it("blocks when fee model is set without HOA", () => {
    expect(isHoaBlocking(baseDesign({ hoaCode: "" }))).toBe(true);
    expect(hoaBlockMessage(baseDesign({ hoaCode: "" }))).toMatch(/Head of Account/);
    expect(isHoaBlocking(baseDesign({ hoaCode: "0070" }))).toBe(false);
    expect(isHoaBlocking(emptyFeeDesign("x"))).toBe(false);
  });

  it("requires amount or slabs before advance", () => {
    expect(isFeeDesignReadyToAdvance(baseDesign({ hoaCode: "0070", baseAmountPaise: 0 }))).toBe(false);
    expect(isFeeDesignReadyToAdvance(baseDesign({ hoaCode: "0070", baseAmountPaise: 50000 }))).toBe(true);
    expect(
      isFeeDesignReadyToAdvance(
        baseDesign({
          feeModel: "slab",
          hoaCode: "0070",
          slabs: [{ id: "s1", from: "", to: "", rate: "100", type: "flat" }],
        }),
      ),
    ).toBe(true);
  });

  it("suggests micro-enterprise exemption sample values", () => {
    const exemptions: FeeExemptionUi[] = [
      { id: "e1", attribute: "category", op: "eq", value: "micro", kind: "percent", amount: "50", label: "Micro" },
    ];
    expect(suggestExemptSampleValues(exemptions)).toEqual({ category: "micro" });
    expect(suggestFullFeeSampleValues(exemptions, [])).toEqual({ category: "micro_other" });
  });
});

describe("isFeeBlocking (D4c #7 — the fee is money, so it blocks Next)", () => {
  const base = { feeModel: null, baseAmountPaise: 0, slabs: [], formula: undefined } as never;
  it("does not block before a fee model is chosen, nor for the engine model", () => {
    expect(isFeeBlocking(base)).toBe(false);
    expect(isFeeBlocking({ ...(base as object), feeModel: "engine" } as never)).toBe(false);
  });
  it("blocks a fixed fee with no amount and clears once there is one", () => {
    expect(isFeeBlocking({ ...(base as object), feeModel: "flat" } as never)).toBe(true);
    expect(isFeeBlocking({ ...(base as object), feeModel: "flat", baseAmountPaise: 50000 } as never)).toBe(false);
  });
  it("blocks a slab model with no slabs and no formula", () => {
    expect(isFeeBlocking({ ...(base as object), feeModel: "slab" } as never)).toBe(true);
    expect(isFeeBlocking({ ...(base as object), feeModel: "slab", formula: "area * 2" } as never)).toBe(false);
  });
});
