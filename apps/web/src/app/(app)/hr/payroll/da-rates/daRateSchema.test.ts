import { describe, it, expect } from "vitest";
import { parseDaRateForm } from "./daRateSchema";

const ORDER = "MoF DoE OM No. 1/1/2026-E.II(B) dated 28.03.2026";

describe("parseDaRateForm", () => {
  it("accepts a first-of-month date, a percentage and an order reference", () => {
    expect(parseDaRateForm({ effectiveFrom: "2026-07-01", ratePct: "60.5", orderRef: ORDER }))
      .toEqual({ ok: true, payload: { effectiveFrom: "2026-07-01", rateBps: 6050, orderRef: ORDER } });
    expect(parseDaRateForm({ effectiveFrom: "2026-01-01", ratePct: "0", orderRef: ORDER })).toMatchObject({ ok: true, payload: { rateBps: 0 } });
  });

  it("rejects mid-month and malformed dates", () => {
    for (const d of ["2026-07-15", "", "2026-02-30-01", "01/07/2026"]) {
      expect(parseDaRateForm({ effectiveFrom: d, ratePct: "58", orderRef: ORDER })).toMatchObject({ ok: false, field: "effectiveFrom" });
    }
  });

  it("rejects non-numeric, negative and over-200% rates", () => {
    for (const r of ["", "abc", "-1", "250"]) {
      expect(parseDaRateForm({ effectiveFrom: "2026-07-01", ratePct: r, orderRef: ORDER })).toMatchObject({ ok: false, field: "ratePct" });
    }
  });

  it("requires a real order reference", () => {
    expect(parseDaRateForm({ effectiveFrom: "2026-07-01", ratePct: "58", orderRef: " short " })).toMatchObject({ ok: false, field: "orderRef" });
  });
});
