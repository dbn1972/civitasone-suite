import { describe, it, expect } from "vitest";
import { checkLines } from "./demandLinesForm";

describe("checkLines (GAP-FINANCE-BUDGET-DEMAND-GRANTS-04)", () => {
  it("accepts a split that totals the demand exactly, in paise", () => {
    const r = checkLines([{ headCode: "2202", amount: "600.50" }, { headCode: "2203", amount: "399.50" }], "100000");
    expect(r).toEqual({ ok: true, totalMinor: "100000", lines: [{ headCode: "2202", amountMinor: "60050" }, { headCode: "2203", amountMinor: "39950" }] });
  });
  it("rejects a split that does not total the demand", () => {
    expect(checkLines([{ headCode: "2202", amount: "10" }], "100000")).toMatchObject({ ok: false, reason: "mismatch", totalMinor: "1000" });
  });
  it("rejects empty, headless, bad-amount and duplicate rows", () => {
    expect(checkLines([], "100")).toMatchObject({ ok: false, reason: "empty" });
    expect(checkLines([{ headCode: " ", amount: "1" }], "100")).toMatchObject({ ok: false, reason: "head" });
    expect(checkLines([{ headCode: "2202", amount: "1.234" }], "100")).toMatchObject({ ok: false, reason: "amount" });
    expect(checkLines([{ headCode: "2202", amount: "0" }], "100")).toMatchObject({ ok: false, reason: "amount" });
    expect(checkLines([{ headCode: "2202", amount: "1" }, { headCode: "2202", amount: "1" }], "200")).toMatchObject({ ok: false, reason: "duplicate" });
  });
});
