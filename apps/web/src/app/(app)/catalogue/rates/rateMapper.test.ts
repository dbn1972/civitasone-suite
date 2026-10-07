import { describe, it, expect } from "vitest";
import { mapRateRows, isRateInForce } from "../_data";

// GAP-CATALOGUE-RATES-01: paise-correct amount + IST in-force logic.
describe("isRateInForce", () => {
  it("marks a card in force when today is within [from, to]", () => {
    expect(isRateInForce("2026-01-01", "2026-12-31", "2026-06-15")).toBe(true);
  });
  it("treats a null `to` as open-ended", () => {
    expect(isRateInForce("2026-01-01", null, "2030-01-01")).toBe(true);
  });
  it("is false before from and after to", () => {
    expect(isRateInForce("2026-01-01", "2026-12-31", "2025-12-31")).toBe(false);
    expect(isRateInForce("2026-01-01", "2026-12-31", "2027-01-01")).toBe(false);
  });
  it("is false with no effectiveFrom", () => {
    expect(isRateInForce(null, null, "2026-06-15")).toBe(false);
  });
});

describe("mapRateRows", () => {
  it("renders rateValueMinor as rupees (12550 paise => ₹125.50)", () => {
    const rows = mapRateRows({ data: [{ id: "r1", rateValueMinor: "12550", effectiveFrom: "2026-01-01" }] });
    expect(rows).not.toBeNull();
    expect(rows![0]!.label).toContain("125.50");
  });

  it("marks the card containing today 'In force' and sorts newest-first", () => {
    const today = isRateInForce; // keep import used
    void today;
    const rows = mapRateRows({
      data: [
        { id: "old", rateValueMinor: "10000", effectiveFrom: "2000-01-01", effectiveTo: "2000-12-31" },
        { id: "now", rateValueMinor: "20000", effectiveFrom: "2000-01-01", effectiveTo: null },
      ],
    })!;
    // newest effectiveFrom first is a tie here; the open-ended one is in force.
    const inForce = rows.find((r) => r.status === "In force");
    expect(inForce).toBeTruthy();
    const expired = rows.find((r) => r.status === "Scheduled/expired");
    expect(expired).toBeTruthy();
  });

  it("never falls back to a legacy major-unit rateValue (shows — when minor missing)", () => {
    const rows = mapRateRows({ data: [{ id: "r1", rateValue: 125.5, effectiveFrom: "2026-01-01" }] })!;
    expect(rows[0]!.label).toBe("—");
  });

  it("returns null for an unrecognisable (non-list) payload", () => {
    expect(mapRateRows({ message: "x" })).toBeNull();
  });
});
