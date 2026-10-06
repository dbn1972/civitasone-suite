/**
 * GAP-COURT-HOME-04: pins the NCMS clearance-rate contract the court home KPIs
 * depend on — disposed/instituted to one decimal, and null (NOT 0%) over an
 * empty base so the UI never presents a fabricated judicial statistic. The
 * route (case-registry/routes.ts GET /cases/analytics) delegates to this pure
 * helper and is gated by requireRole(COURT_READ_ROLES); the full DB+RLS+HTTP
 * path is covered by analytics.e2e.test.ts (opt-in COURT_E2E=1).
 */
import { describe, it, expect } from "vitest";
import { clearanceRatePct } from "../src/modules/case-registry/domain.js";

describe("clearanceRatePct (GAP-COURT-HOME-04)", () => {
  it("is disposed/instituted as a whole percent when they divide evenly", () => {
    expect(clearanceRatePct(10, 8)).toBe(80);
  });

  it("keeps one decimal place", () => {
    expect(clearanceRatePct(3, 1)).toBeCloseTo(33.3, 1);
  });

  it("is null (not 0) when nothing was instituted", () => {
    expect(clearanceRatePct(0, 0)).toBeNull();
  });

  it("is null for a negative or non-finite base rather than a bogus number", () => {
    expect(clearanceRatePct(-5, 2)).toBeNull();
    expect(clearanceRatePct(Number.NaN, 2)).toBeNull();
  });

  it("can exceed 100 when disposed > instituted in the window (carry-over disposals)", () => {
    // Honest reporting: the helper does not clamp — a window that disposes
    // more than it institutes is a real, reportable NCMS situation.
    expect(clearanceRatePct(10, 12)).toBe(120);
  });
});
