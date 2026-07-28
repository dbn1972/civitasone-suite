/**
 * DIC engagement-type ATTENDANCE applicability — the payroll-input feed uses
 * attendanceLopApplies() to decide whether a type's muster absence drives salary
 * Loss-of-Pay. Salaried types on a muster (pay_scale/contractual) → LOP applies;
 * consultants (invoice), third-party (agency), apprentices (stipend) → never.
 */
import { describe, it, expect } from "vitest";
import {
  buildTypeResolver,
  attendanceLopApplies,
  toPolicy,
  DEFAULT_POLICY,
} from "../src/modules/employee/engagement-policy.js";

const canonical = [
  { category: "pay_scale",   eligibleForPayroll: true,  attendanceMode: "muster_lop" },
  { category: "contractual", eligibleForPayroll: true,  attendanceMode: "muster_lop" },
  { category: "consultant",  eligibleForPayroll: false, attendanceMode: "none" },
  { category: "third_party", eligibleForPayroll: false, attendanceMode: "informational" },
  { category: "apprentice",  eligibleForPayroll: false, attendanceMode: "informational" },
];

describe("attendanceLopApplies", () => {
  it("applies LOP for salaried muster types (pay_scale, contractual)", () => {
    const r = buildTypeResolver([], canonical);
    expect(attendanceLopApplies(r("pay_scale"))).toBe(true);
    expect(attendanceLopApplies(r("contractual"))).toBe(true);
  });

  it("never docks salary for invoice / agency / stipend types", () => {
    const r = buildTypeResolver([], canonical);
    expect(attendanceLopApplies(r("consultant"))).toBe(false);   // none
    expect(attendanceLopApplies(r("third_party"))).toBe(false);  // informational
    expect(attendanceLopApplies(r("apprentice"))).toBe(false);   // informational
  });

  it("a payroll-eligible type that is only informational still gets no salary LOP", () => {
    // guards the AND: eligibleForPayroll alone is not enough — mode must be muster_lop
    const p = toPolicy({ eligibleForPayroll: true, attendanceMode: "informational" });
    expect(attendanceLopApplies(p)).toBe(false);
  });

  it("defaults to muster_lop so pre-engagement-typing employees keep LOP behaviour", () => {
    expect(DEFAULT_POLICY.attendanceMode).toBe("muster_lop");
    expect(attendanceLopApplies(DEFAULT_POLICY)).toBe(true);
    // a row with no attendance_mode column normalises to muster_lop
    expect(toPolicy({ eligibleForPayroll: true }).attendanceMode).toBe("muster_lop");
  });
});
