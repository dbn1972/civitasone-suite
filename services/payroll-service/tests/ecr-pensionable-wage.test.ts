/**
 * PAY-DEF01 regression: EPFO pensionable wage must be min(Basic + DA, 15000).
 * The old ECR generation used Basic alone — for a 7th CPC employee with
 * basic 12,000 + DA 5,000 the ECR showed 12,000 instead of 15,000 and the
 * challan was rejected by the EPFO portal.
 *
 * Independent oracle values (not derived from the implementation).
 */
import { describe, it, expect } from "vitest";
import { computePensionableWage, EPF_WAGE_CEILING } from "../src/modules/statutory/ecr-domain.js";

describe("EPFO pensionable wage (PAY-DEF01)", () => {
  it("caps basic+DA at the Rs 15,000 ceiling", () => {
    // 7th CPC typical: basic 12,000 + DA 5,000 → capped to 15,000 (old code: 12,000)
    expect(computePensionableWage(12000, 5000)).toBe(15000);
  });

  it("uses full basic+DA when under the ceiling", () => {
    expect(computePensionableWage(8000, 2000)).toBe(10000);
  });

  it("includes DA even when basic alone is under the ceiling", () => {
    // old code returned 9,000 here (basic only) — the defect signature
    expect(computePensionableWage(9000, 4500)).toBe(13500);
  });

  it("handles zero DA (basic-only employees) unchanged", () => {
    expect(computePensionableWage(14000, 0)).toBe(14000);
  });

  it("caps basic alone above the ceiling", () => {
    expect(computePensionableWage(56100, 0)).toBe(EPF_WAGE_CEILING);
  });
});
