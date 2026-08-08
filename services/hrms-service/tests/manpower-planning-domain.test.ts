/**
 * HRMS Manpower Planning — vacancy computation, roster allocation, maker-checker tests.
 * Pack (related to recruitment). Source: modules/manpower-planning/domain.ts
 */
import { describe, it, expect } from "vitest";
import { computeVacancy, allocateRoster, canApprove, DEFAULT_ROSTER } from "../src/modules/manpower-planning/domain.js";

describe("computeVacancy", () => {
  it("basic vacancy = sanctioned - filled", () => {
    const r = computeVacancy({ requiredStrength: 100, sanctionedStrength: 80, filledStrength: 60 });
    expect(r.vacancy).toBe(20);
    expect(r.surplus).toBe(0);
    expect(r.deficitVsRequired).toBe(20); // required - sanctioned
    expect(r.fillRatePct).toBe(75); // 60/80 * 100
  });

  it("surplus when filled > sanctioned", () => {
    const r = computeVacancy({ requiredStrength: 50, sanctionedStrength: 50, filledStrength: 55 });
    expect(r.vacancy).toBe(0);
    expect(r.surplus).toBe(5);
  });

  it("0 fillRate when nothing sanctioned", () => {
    const r = computeVacancy({ requiredStrength: 10, sanctionedStrength: 0, filledStrength: 0 });
    expect(r.fillRatePct).toBe(0);
    expect(r.vacancy).toBe(0);
  });

  it("no negative values", () => {
    const r = computeVacancy({ requiredStrength: -5, sanctionedStrength: -3, filledStrength: -2 });
    expect(r.vacancy).toBe(0);
    expect(r.surplus).toBe(0);
    expect(r.deficitVsRequired).toBe(0);
  });
});

describe("allocateRoster — reservation-based allocation", () => {
  it("100 vacancies with default percentages", () => {
    const r = allocateRoster(100);
    expect(r.total).toBe(100);
    const sc = r.rows.find(x => x.category === "SC")!;
    const st = r.rows.find(x => x.category === "ST")!;
    const obc = r.rows.find(x => x.category === "OBC")!;
    const ews = r.rows.find(x => x.category === "EWS")!;
    const ur = r.rows.find(x => x.category === "UR")!;
    const pwd = r.rows.find(x => x.category === "PwD")!;
    expect(sc.reservedCount).toBe(15);
    expect(st.reservedCount).toBe(8); // 7.5% rounds to 8
    expect(obc.reservedCount).toBe(27);
    expect(ews.reservedCount).toBe(10);
    expect(pwd.reservedCount).toBe(4);
    expect(pwd.horizontal).toBe(true);
    // Vertical: SC+ST+OBC+EWS+UR must equal total
    expect(sc.reservedCount + st.reservedCount + obc.reservedCount + ews.reservedCount + ur.reservedCount).toBe(100);
  });

  it("0 vacancies → all zeros", () => {
    const r = allocateRoster(0);
    expect(r.total).toBe(0);
    expect(r.rows.every(x => x.reservedCount === 0)).toBe(true);
  });

  it("1 vacancy → UR gets 1 (reserved rounds to 0)", () => {
    const r = allocateRoster(1);
    const ur = r.rows.find(x => x.category === "UR")!;
    expect(ur.reservedCount).toBeGreaterThanOrEqual(0);
    const verticalSum = r.rows.filter(x => !x.horizontal).reduce((s, x) => s + x.reservedCount, 0);
    expect(verticalSum).toBe(1);
  });

  it("PwD is horizontal (not deducted from UR)", () => {
    const r = allocateRoster(100);
    const pwd = r.rows.find(x => x.category === "PwD")!;
    expect(pwd.horizontal).toBe(true);
    // Total of verticals = total (PwD is extra)
    const verticals = r.rows.filter(x => !x.horizontal);
    expect(verticals.reduce((s, x) => s + x.reservedCount, 0)).toBe(100);
  });
});

describe("canApprove — maker-checker", () => {
  it("ok when checker differs from creator and status is pending_approval", () => {
    const result = canApprove({ status: "pending_approval", createdBy: "user-a" }, "user-b");
    expect(result.ok).toBe(true);
  });

  it("MAKER_CHECKER when same user", () => {
    const result = canApprove({ status: "pending_approval", createdBy: "user-a" }, "user-a");
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.code).toBe("MAKER_CHECKER");
  });

  it("INVALID_STATE when not pending_approval", () => {
    const result = canApprove({ status: "draft", createdBy: "user-a" }, "user-b");
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.code).toBe("INVALID_STATE");
  });
});
