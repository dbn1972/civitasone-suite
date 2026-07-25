/**
 * Manpower-planning domain — pure unit tests (SVC-003).
 * Covers vacancy computation, reservation-roster allocation, and the
 * maker-checker approval guard. No DB / no I/O.
 */
import { describe, it, expect } from "vitest";
import {
  computeVacancy, allocateRoster, canApprove, DEFAULT_ROSTER,
} from "../src/modules/manpower-planning/domain.js";

describe("computeVacancy", () => {
  it("vacancy = sanctioned − filled (bounded by sanction, not required)", () => {
    const r = computeVacancy({ requiredStrength: 30, sanctionedStrength: 20, filledStrength: 12 });
    expect(r.vacancy).toBe(8);
    expect(r.surplus).toBe(0);
    expect(r.deficitVsRequired).toBe(10); // required 30 − sanctioned 20
    expect(r.fillRatePct).toBe(60);       // 12/20
  });

  it("never returns a negative vacancy when over-strength", () => {
    const r = computeVacancy({ requiredStrength: 10, sanctionedStrength: 10, filledStrength: 13 });
    expect(r.vacancy).toBe(0);
    expect(r.surplus).toBe(3);   // 13 − 10
    expect(r.fillRatePct).toBe(130);
  });

  it("fillRate is 0 when nothing is sanctioned (no divide-by-zero)", () => {
    const r = computeVacancy({ requiredStrength: 5, sanctionedStrength: 0, filledStrength: 0 });
    expect(r.vacancy).toBe(0);
    expect(r.fillRatePct).toBe(0);
    expect(r.deficitVsRequired).toBe(5);
  });

  it("truncates and floors negative inputs defensively", () => {
    const r = computeVacancy({ requiredStrength: -4, sanctionedStrength: 9.9, filledStrength: 2.4 });
    expect(r.vacancy).toBe(7); // sanctioned trunc→9, filled trunc→2
    expect(r.deficitVsRequired).toBe(0);
  });
});

describe("allocateRoster", () => {
  it("vertical rows + UR sum EXACTLY to the total", () => {
    const a = allocateRoster(100);
    const vertical = a.rows.filter((r) => r.category !== "PwD");
    const sum = vertical.reduce((s, r) => s + r.reservedCount, 0);
    expect(sum).toBe(100);
  });

  it("applies GOI default percentages on a 100-point roster", () => {
    const a = allocateRoster(100, DEFAULT_ROSTER);
    const by = Object.fromEntries(a.rows.map((r) => [r.category, r.reservedCount]));
    expect(by.SC).toBe(15);
    expect(by.ST).toBe(8);  // 7.5% of 100 rounds to 8
    expect(by.OBC).toBe(27);
    expect(by.EWS).toBe(10);
    expect(by.UR).toBe(40); // 100 − (15+8+27+10)
    expect(by.PwD).toBe(4);
  });

  it("PwD is horizontal — not deducted from UR", () => {
    const a = allocateRoster(100);
    const pwd = a.rows.find((r) => r.category === "PwD");
    expect(pwd?.horizontal).toBe(true);
    const nonPwdSum = a.rows.filter((r) => r.category !== "PwD").reduce((s, r) => s + r.reservedCount, 0);
    expect(nonPwdSum).toBe(100); // PwD sits on top, doesn't reduce the verticals/UR
  });

  it("handles zero and small totals without going negative", () => {
    expect(allocateRoster(0).rows.every((r) => r.reservedCount === 0)).toBe(true);
    const a = allocateRoster(3);
    const sum = a.rows.filter((r) => r.category !== "PwD").reduce((s, r) => s + r.reservedCount, 0);
    expect(sum).toBe(3);
    expect(a.rows.every((r) => r.reservedCount >= 0)).toBe(true);
  });
});

describe("canApprove (maker-checker guard)", () => {
  const plan = { status: "pending_approval", createdBy: "maker-1" };

  it("rejects the creator approving their own plan", () => {
    const g = canApprove(plan, "maker-1");
    expect(g.ok).toBe(false);
    if (!g.ok) expect(g.code).toBe("MAKER_CHECKER");
  });

  it("allows a different checker to approve", () => {
    expect(canApprove(plan, "checker-2").ok).toBe(true);
  });

  it("rejects approval unless the plan is pending_approval", () => {
    const g = canApprove({ status: "draft", createdBy: "maker-1" }, "checker-2");
    expect(g.ok).toBe(false);
    if (!g.ok) expect(g.code).toBe("INVALID_STATE");
  });
});
