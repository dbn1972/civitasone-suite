import { describe, it, expect } from "vitest";
import { financialYearOf, currentFinancialYear } from "./fiscalYear";

describe("fiscalYear", () => {
  it("maps an August date to the FY that started that April", () => {
    expect(financialYearOf(new Date("2026-08-26T00:00:00Z"))).toBe("2026-27");
  });
  it("maps 1 April to the new FY (boundary)", () => {
    expect(financialYearOf(new Date("2026-04-01T00:00:00Z"))).toBe("2026-27");
  });
  it("maps a pre-April date to the previous FY", () => {
    expect(financialYearOf(new Date("2026-02-15T00:00:00Z"))).toBe("2025-26");
  });
  it("pads the two-digit end year across a decade boundary", () => {
    expect(financialYearOf(new Date("2009-05-01T00:00:00Z"))).toBe("2009-10");
  });
  it("currentFinancialYear honours an injected clock", () => {
    expect(currentFinancialYear(new Date("2026-08-26T00:00:00Z"))).toBe("2026-27");
  });
});
