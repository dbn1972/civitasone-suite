import { describe, it, expect } from "vitest";
import {
  buildAssignBody,
  buildBulkBody,
  buildEndBody,
  firstOfNextMonth,
  hasNoRows,
  isIsoDate,
  membershipFormProblem,
  pageWindow,
  parseBulkRejection,
  parseBulkResult,
  parseEmployeeCsv,
  parseOffset,
  parseRunCreateResult,
  parseTab,
  rejectCodeKey,
  resolveMonth,
  runScopeFields,
  runScopeProblem,
  BULK_MAX_ROWS,
} from "./payGroupMembership";

describe("firstOfNextMonth", () => {
  it("returns the 1st of the following month", () => {
    expect(firstOfNextMonth("2026-10-03")).toBe("2026-11-01");
    expect(firstOfNextMonth("2026-01-31")).toBe("2026-02-01");
  });
  it("rolls December over to January of the next year", () => {
    expect(firstOfNextMonth("2026-12-15")).toBe("2027-01-01");
  });
  it("returns an empty string for a malformed date", () => {
    expect(firstOfNextMonth("nope")).toBe("");
  });
});

describe("dates and months", () => {
  it("validates real calendar dates only", () => {
    expect(isIsoDate("2026-02-28")).toBe(true);
    expect(isIsoDate("2026-02-30")).toBe(false);
    expect(isIsoDate("")).toBe(false);
  });
  it("falls back to the default month for a garbled param", () => {
    expect(resolveMonth("2026-07", "2026-10")).toBe("2026-07");
    expect(resolveMonth("2026-13", "2026-10")).toBe("2026-10");
    expect(resolveMonth(undefined, "2026-10")).toBe("2026-10");
  });
});

describe("membershipFormProblem", () => {
  const ok = { date: "2026-11-01", reason: "Posted to new office" };
  it("accepts a valid form", () => {
    expect(membershipFormProblem(ok)).toBeNull();
  });
  it("rejects a bad date, a missing target and a short reason, in that order", () => {
    expect(membershipFormProblem({ ...ok, date: "" })).toBe("dateInvalid");
    expect(membershipFormProblem({ ...ok, needTarget: true, target: "" })).toBe("targetRequired");
    expect(membershipFormProblem({ ...ok, reason: "too short" })).toBe("reasonShort");
  });
});

describe("payload builders", () => {
  it("builds an assign body with employeeId only", () => {
    expect(buildAssignBody({ employeeId: "e1", effectiveFrom: "2026-11-01", reason: "  Joined the office  " })).toEqual({
      employeeId: "e1",
      effectiveFrom: "2026-11-01",
      reason: "Joined the office",
    });
  });
  it("builds an assign body with employeeNo only", () => {
    expect(buildAssignBody({ employeeNo: " E-100 ", effectiveFrom: "2026-11-01", reason: "Joined the office" })).toEqual({
      employeeNo: "E-100",
      effectiveFrom: "2026-11-01",
      reason: "Joined the office",
    });
  });
  it("builds end and bulk bodies", () => {
    expect(buildEndBody({ endsOn: "2026-12-01", reason: " Moved out of cadre " })).toEqual({ endsOn: "2026-12-01", reason: "Moved out of cadre" });
    expect(buildBulkBody({ effectiveFrom: "2026-11-01", reason: "Bulk onboarding", employeeNos: ["A1", "A2"] })).toEqual({
      effectiveFrom: "2026-11-01",
      reason: "Bulk onboarding",
      rows: [{ employeeNo: "A1" }, { employeeNo: "A2" }],
    });
  });
});

describe("parseEmployeeCsv", () => {
  it("reads one employee number per line, skipping blanks and CRLF", () => {
    expect(parseEmployeeCsv("E1\r\n\r\nE2\n  E3  \n").employeeNos).toEqual(["E1", "E2", "E3"]);
  });
  it("reads the employeeNo column of a CSV with a header", () => {
    const csv = 'name,Employee No,dept\nAsha,"E10",Fin\nRavi,E11,HR';
    expect(parseEmployeeCsv(csv).employeeNos).toEqual(["E10", "E11"]);
  });
  it("drops and counts duplicates", () => {
    const r = parseEmployeeCsv("E1\nE2\nE1\nE1");
    expect(r.employeeNos).toEqual(["E1", "E2"]);
    expect(r.duplicateCount).toBe(2);
  });
  it("flags more rows than the backend accepts", () => {
    const text = Array.from({ length: BULK_MAX_ROWS + 1 }, (_, i) => `E${i}`).join("\n");
    expect(parseEmployeeCsv(text).exceedsLimit).toBe(true);
    expect(parseEmployeeCsv("E1").exceedsLimit).toBe(false);
  });
  it("treats empty text as no rows", () => {
    expect(parseEmployeeCsv("  \n ").employeeNos).toEqual([]);
  });
});

describe("bulk result parsing", () => {
  it("reads accepted/rejected from a 202 body", () => {
    const r = parseBulkResult({ data: { accepted: 2, rejected: [{ row: 1, employeeNo: "E9", code: "ALREADY_MEMBER", message: "x" }] } });
    expect(r).toEqual({ accepted: 2, rejected: [{ row: 1, employeeNo: "E9", code: "ALREADY_MEMBER" }] });
  });
  it("reads a 422 rejection's details", () => {
    expect(parseBulkRejection({ rejected: [{ row: 0, employeeNo: null, code: "EMPLOYEE_NOT_FOUND" }] })).toEqual({
      accepted: 0,
      rejected: [{ row: 0, employeeNo: null, code: "EMPLOYEE_NOT_FOUND" }],
    });
    expect(parseBulkRejection(undefined).rejected).toEqual([]);
  });
  it("maps unknown rejection codes to a generic key", () => {
    expect(rejectCodeKey("ALREADY_MEMBER")).toBe("ALREADY_MEMBER");
    expect(rejectCodeKey("WHATEVER")).toBe("OTHER");
  });
});

describe("paging and tabs", () => {
  it("computes the window", () => {
    expect(pageWindow(120, 50, 0)).toEqual({ from: 1, to: 50, prevOffset: null, nextOffset: 50 });
    expect(pageWindow(120, 50, 100)).toEqual({ from: 101, to: 120, prevOffset: 50, nextOffset: null });
    expect(pageWindow(0, 50, 0)).toEqual({ from: 0, to: 0, prevOffset: null, nextOffset: null });
  });
  it("parses offsets and tabs defensively", () => {
    expect(parseOffset("50")).toBe(50);
    expect(parseOffset("-5")).toBe(0);
    expect(parseOffset("abc")).toBe(0);
    expect(parseTab("members")).toBe("members");
    expect(parseTab("x")).toBe("details");
  });
  it("hasNoRows treats null and [] as empty", () => {
    expect(hasNoRows([])).toBe(true);
    expect(hasNoRows(null)).toBe(true);
    expect(hasNoRows([1])).toBe(false);
  });
});

describe("run scope", () => {
  it("adds no fields for a whole-tenant run (legacy payload)", () => {
    expect(runScopeFields({ kind: "tenant" })).toEqual({});
    expect(runScopeProblem({ kind: "tenant" })).toBeNull();
  });
  it("uses payGroupId for one group and payGroupIds for several", () => {
    expect(runScopeFields({ kind: "groups", ids: ["g1"] })).toEqual({ payGroupId: "g1" });
    expect(runScopeFields({ kind: "groups", ids: ["g1", "g2"] })).toEqual({ payGroupIds: ["g1", "g2"] });
  });
  it("uses ddoCode + allPayGroupsOfDdo for a DDO run", () => {
    expect(runScopeFields({ kind: "ddo", ddoCode: "DDO-1" })).toEqual({ ddoCode: "DDO-1", allPayGroupsOfDdo: true });
  });
  it("validates selections", () => {
    expect(runScopeProblem({ kind: "groups", ids: [] })).toBe("groupsRequired");
    expect(runScopeProblem({ kind: "groups", ids: Array.from({ length: 21 }, (_, i) => `g${i}`) })).toBe("groupsTooMany");
    expect(runScopeProblem({ kind: "ddo", ddoCode: "" })).toBe("ddoRequired");
  });
  it("parses scoped and legacy create responses", () => {
    expect(parseRunCreateResult({ id: "c1", data: { runIds: ["r1", "r2"], skippedEmptyGroups: ["g3"] } })).toEqual({
      id: "c1",
      runIds: ["r1", "r2"],
      skippedEmptyGroups: ["g3"],
    });
    expect(parseRunCreateResult({ id: "run-1" })).toEqual({ id: "run-1", runIds: [], skippedEmptyGroups: [] });
    expect(parseRunCreateResult(null).runIds).toEqual([]);
  });
});
