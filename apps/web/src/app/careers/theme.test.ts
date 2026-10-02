import { describe, it, expect } from "vitest";
import { contrast } from "@/lib/contrast";
import { CAREERS_ACTIVE, CAREERS_MUTED, CAREERS_PRIMARY } from "./theme";

// GAP-RECRUITMENT-CAREERS-DETAIL-07 / HOME-08 / PORTAL-05
describe("careers colour tokens meet WCAG AA (4.5:1) for small text", () => {
  for (const bg of ["#ffffff", "#f8fafc", "#f0f4f8"]) {
    it(`muted text on ${bg}`, () => expect(contrast(CAREERS_MUTED, bg)).toBeGreaterThanOrEqual(4.5));
    it(`active-step accent on ${bg}`, () => expect(contrast(CAREERS_ACTIVE, bg)).toBeGreaterThanOrEqual(4.5));
  }
  it("white text on the primary button", () => expect(contrast("#ffffff", CAREERS_PRIMARY)).toBeGreaterThanOrEqual(4.5));
  it("the old #94a3b8 would have failed (guards the test itself)", () => expect(contrast("#94a3b8", "#ffffff")).toBeLessThan(4.5));
});
