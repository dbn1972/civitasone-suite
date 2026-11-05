/**
 * UAT b18 (EPF for contract staff, 2026-11-05) -- pure pension scheme rules.
 *   D1  default scheme at hire by rule; scheme in effect per wage month; retro periods.
 *   D3  UAN must be 12 digits; an EPF member without one is incomplete.
 *   D7  the legacy "contract" engagement type is not NPS-eligible.
 */
import { describe, it, expect } from "vitest";
import {
  defaultPensionScheme, schemeForMonth, retroPeriods, statutoryIncomplete, isValidUan, schemeChangeVerdict, attains58On, epsAgeCutoffReached,
} from "../src/modules/employee/pension-scheme.js";
import { buildTypeResolver, DEFAULT_POLICY } from "../src/modules/employee/engagement-policy.js";
import { createEmployeeBody, updateEmployeeBody } from "../src/modules/employee/validators.js";
import { pensionSchemeChangeBody } from "../src/modules/employee/pension-scheme-routes.js";

describe("D1: default pension scheme at hire", () => {
  it("contract / contractual / PSU staff are EPF members, whatever the joining date", () => {
    expect(defaultPensionScheme({ dateOfJoining: "2026-10-28", employeeType: "contract" })).toBe("EPF");
    expect(defaultPensionScheme({ dateOfJoining: "2026-10-28", employeeType: "Contractual" })).toBe("EPF");
    expect(defaultPensionScheme({ dateOfJoining: "1999-06-01", employeeType: "psu" })).toBe("EPF");
    expect(defaultPensionScheme({ dateOfJoining: "1999-06-01", employeeType: "contract" })).toBe("EPF");
  });
  it("joined before 2004-01-01 -> GPF; on/after -> NPS", () => {
    expect(defaultPensionScheme({ dateOfJoining: "2003-12-31", employeeType: "permanent" })).toBe("GPF");
    expect(defaultPensionScheme({ dateOfJoining: "2004-01-01", employeeType: "permanent" })).toBe("NPS");
    expect(defaultPensionScheme({ dateOfJoining: "2026-10-28", employeeType: null })).toBe("NPS");
  });
});

describe("Review SF6: apprentices and consultants are on no pension scheme", () => {
  it("apprentice / consultant -> NONE, whatever the joining date", () => {
    expect(defaultPensionScheme({ dateOfJoining: "2026-10-28", employeeType: "apprentice" })).toBe("NONE");
    expect(defaultPensionScheme({ dateOfJoining: "1999-01-01", employeeType: "Consultant" })).toBe("NONE");
  });
});

describe("Review SF5: scheme change eligibility matrix", () => {
  const v = (employeeType: string, dateOfJoining: string, fromScheme: string, toScheme: string, history: Array<{ fromScheme: string; toScheme: string }> = []) =>
    schemeChangeVerdict({ employeeType, dateOfJoining, fromScheme, toScheme, history }).ok;
  it("contract / PSU -> EPF only", () => {
    expect(v("contract", "2026-10-28", "NPS", "EPF")).toBe(true);
    expect(v("psu", "1999-01-01", "GPF", "EPF")).toBe(true);
    for (const to of ["NPS", "GPF", "UPS"]) expect(v("contract", "2026-10-28", "EPF", to)).toBe(false);
  });
  it("regular, joined before 2004 -> GPF only", () => {
    expect(v("permanent", "2003-12-31", "NPS", "GPF")).toBe(true);
    expect(v("permanent", "2003-12-31", "GPF", "NPS")).toBe(false);
    expect(v("permanent", "2003-12-31", "NPS", "UPS")).toBe(false);
  });
  it("regular, joined 2004 or later: NPS -> UPS once; UPS -> NPS (switch back) once; nothing else", () => {
    expect(v("permanent", "2010-01-01", "NPS", "UPS")).toBe(true);
    expect(v("permanent", "2010-01-01", "EPF", "UPS")).toBe(false);
    expect(v("permanent", "2010-01-01", "NPS", "UPS", [{ fromScheme: "NPS", toScheme: "UPS" }, { fromScheme: "UPS", toScheme: "NPS" }])).toBe(false);
    expect(v("permanent", "2010-01-01", "UPS", "NPS", [{ fromScheme: "NPS", toScheme: "UPS" }])).toBe(true);
    expect(v("permanent", "2010-01-01", "UPS", "NPS", [{ fromScheme: "UPS", toScheme: "NPS" }, { fromScheme: "NPS", toScheme: "UPS" }])).toBe(false);
    expect(v("permanent", "2010-01-01", "NPS", "GPF")).toBe(false);
    expect(v("permanent", "2010-01-01", "NPS", "EPF")).toBe(false);
    expect(v("permanent", "2010-01-01", "EPF", "NPS")).toBe(false);
  });
  it("apprentices / consultants move only to NONE (delta review SF3: the existing ones on NPS can be moved); nobody else does", () => {
    for (const to of ["GPF", "NPS", "EPF", "UPS"]) expect(v("apprentice", "2026-01-01", "NONE", to)).toBe(false);
    expect(v("apprentice", "2026-01-01", "NPS", "NONE")).toBe(true);
    expect(v("consultant", "2020-01-01", "NPS", "NONE")).toBe(true);
    expect(v("permanent", "2010-01-01", "NPS", "NONE")).toBe(false);
    expect(v("contract", "2026-01-01", "EPF", "NONE")).toBe(false);
  });
  it("a refusal carries the code and a readable reason", () => {
    expect(schemeChangeVerdict({ employeeType: "contract", dateOfJoining: "2026-10-28", fromScheme: "EPF", toScheme: "NPS", history: [] }))
      .toEqual({ ok: false, code: "PENSION_SCHEME_NOT_ALLOWED", reason: "contract and PSU staff are EPF members only" });
  });
});

describe("Review SF1: the 58th-birthday date (sent to payroll instead of the DOB)", () => {
  it("payroll-input gets only the per-month boolean: 58 before the month began", () => {
    expect(epsAgeCutoffReached("1969-02-15", "2027-02")).toBe(false); // birthday month still counts
    expect(epsAgeCutoffReached("1969-02-15", "2027-03")).toBe(true);
    expect(epsAgeCutoffReached("1969-03-01", "2027-03")).toBe(false);
    expect(epsAgeCutoffReached(null, "2027-03")).toBeNull();
  });
  it("DOB + 58 years; null without a DOB", () => {
    expect(attains58On("1969-02-15")).toBe("2027-02-15");
    expect(attains58On(null)).toBeNull();
    expect(attains58On("bad")).toBeNull();
  });
});

describe("D1: scheme in effect for a wage month", () => {
  const changes = [
    { fromScheme: "NPS", toScheme: "EPF", effectiveFrom: "2027-08-01" },
    { fromScheme: "EPF", toScheme: "UPS", effectiveFrom: "2028-04-01" },
  ];
  it("before the first change: that change's from-scheme (history keeps the old scheme)", () => {
    expect(schemeForMonth("UPS", changes, "2027-07")).toBe("NPS");
    expect(schemeForMonth("UPS", changes, "2026-01")).toBe("NPS");
  });
  it("from each effective month: the new scheme", () => {
    expect(schemeForMonth("UPS", changes, "2027-08")).toBe("EPF");
    expect(schemeForMonth("UPS", changes, "2028-03")).toBe("EPF");
    expect(schemeForMonth("UPS", changes, "2028-04")).toBe("UPS");
  });
  it("no approved change: the recorded scheme", () => {
    expect(schemeForMonth("EPF", [], "2027-02")).toBe("EPF");
  });
  it("order of the input does not matter", () => {
    expect(schemeForMonth("UPS", [...changes].reverse(), "2027-09")).toBe("EPF");
  });
});

describe("D1: retro periods of a back-dated change", () => {
  it("months from the effective month up to the month before today", () => {
    expect(retroPeriods("2026-08-01", "2026-11-04")).toEqual(["2026-08", "2026-09", "2026-10"]);
    expect(retroPeriods("2026-11-01", "2026-11-04")).toEqual([]);
    expect(retroPeriods("2027-01-01", "2026-11-04")).toEqual([]);
    expect(retroPeriods("2026-12-01", "2027-02-10")).toEqual(["2026-12", "2027-01"]);
  });
});

describe("D3: UAN", () => {
  it("exactly 12 digits", () => {
    expect(isValidUan("100200300400")).toBe(true);
    expect(isValidUan("10020030040")).toBe(false);
    expect(isValidUan("10020030040A")).toBe(false);
    expect(isValidUan(null)).toBe(false);
  });
  it("an EPF member without a valid UAN is incomplete; other schemes are not", () => {
    expect(statutoryIncomplete({ pensionScheme: "EPF", uanNumber: null })).toEqual(["UAN_MISSING"]);
    expect(statutoryIncomplete({ pensionScheme: "EPF", uanNumber: "123" })).toEqual(["UAN_MISSING"]);
    expect(statutoryIncomplete({ pensionScheme: "EPF", uanNumber: "100200300400" })).toEqual([]);
    expect(statutoryIncomplete({ pensionScheme: "NPS", uanNumber: null })).toEqual([]);
  });
  it("create / update reject a UAN that is not 12 digits (empty still clears on update)", () => {
    const base = { employeeNo: "E1", fullName: "A", departmentId: "11111111-1111-4111-8111-111111111111", designationId: "11111111-1111-4111-8111-111111111112", dateOfJoining: "2026-10-28" };
    expect(createEmployeeBody.safeParse({ ...base, uanNumber: "12345" }).success).toBe(false);
    expect(createEmployeeBody.parse({ ...base, uanNumber: "100200300400" }).uanNumber).toBe("100200300400");
    expect(createEmployeeBody.parse({ ...base, uanNumber: "" }).uanNumber).toBeUndefined();
    expect(updateEmployeeBody.safeParse({ uanNumber: "UAN-1" }).success).toBe(false);
    expect(updateEmployeeBody.parse({ uanNumber: "" }).uanNumber).toBe("");
  });
  it("create accepts an explicit scheme (UPS option); update refuses any scheme", () => {
    const base = { employeeNo: "E1", fullName: "A", departmentId: "11111111-1111-4111-8111-111111111111", designationId: "11111111-1111-4111-8111-111111111112", dateOfJoining: "2026-10-28" };
    expect(createEmployeeBody.parse({ ...base, pensionScheme: "UPS" }).pensionScheme).toBe("UPS");
    expect(createEmployeeBody.safeParse({ ...base, pensionScheme: "CPF" }).success).toBe(false);
    expect(updateEmployeeBody.safeParse({ pensionScheme: "EPF" }).success).toBe(false);
  });
});

describe("D1: change request body", () => {
  const ok = { toScheme: "EPF", effectiveFrom: "2027-08-01", reason: "Contract staff are EPF members (owner 2026-11-05)" };
  it("accepts a first-of-month date and a real reason", () => {
    expect(pensionSchemeChangeBody.safeParse(ok).success).toBe(true);
  });
  it("rejects a mid-month date, a short reason, an unknown scheme, a bad UAN and extra fields", () => {
    expect(pensionSchemeChangeBody.safeParse({ ...ok, effectiveFrom: "2027-08-15" }).success).toBe(false);
    expect(pensionSchemeChangeBody.safeParse({ ...ok, reason: "too short" }).success).toBe(false);
    expect(pensionSchemeChangeBody.safeParse({ ...ok, toScheme: "CPF" }).success).toBe(false);
    expect(pensionSchemeChangeBody.safeParse({ ...ok, uanNumber: "12345" }).success).toBe(false);
    expect(pensionSchemeChangeBody.safeParse({ ...ok, approvedBy: "x" }).success).toBe(false);
  });
});

describe("D7: legacy contract type is not NPS-eligible", () => {
  const resolve = buildTypeResolver([], []);
  it("contract -> statutoryNps false, PF still on", () => {
    expect(resolve("contract").statutoryNps).toBe(false);
    expect(resolve("contract").statutoryPf).toBe(true);
  });
  it("other legacy types keep the permissive default", () => {
    expect(resolve("permanent")).toEqual(DEFAULT_POLICY);
  });
});
