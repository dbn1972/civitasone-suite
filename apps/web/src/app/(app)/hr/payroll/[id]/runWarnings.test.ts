import { describe, it, expect } from "vitest";
import { parseRunWarnings, warningLinksToEmployees, employeeEditHref, isKnownWarningCode } from "./runWarnings";

describe("parseRunWarnings", () => {
  it("parses codes, counts and the employee sample", () => {
    expect(parseRunWarnings({ runId: "r", warnings: [{ code: "PT_STATE_UNKNOWN", count: 2, sample: [{ employeeId: "e1", employeeNo: "E-1" }, { bad: 1 }], createdAt: "x" }, { code: "HRA_FLOOR_NOT_CONFIGURED", count: 0, sample: [] }] }))
      .toEqual([{ code: "PT_STATE_UNKNOWN", count: 2, sample: [{ employeeId: "e1", employeeNo: "E-1" }] }, { code: "HRA_FLOOR_NOT_CONFIGURED", count: 0, sample: [] }]);
  });
  it("an empty list is valid (no warnings); anything else is a load error, never an empty list", () => {
    expect(parseRunWarnings({ warnings: [] })).toEqual([]);
    expect(parseRunWarnings(null)).toBeNull();
    expect(parseRunWarnings({})).toBeNull();
    expect(parseRunWarnings({ warnings: [{ count: 1 }] })).toBeNull();
  });
  it("links only the employee-fixable codes", () => {
    expect(warningLinksToEmployees("PT_STATE_UNKNOWN")).toBe(true);
    expect(warningLinksToEmployees("PT_GENDER_UNKNOWN")).toBe(true);
    expect(warningLinksToEmployees("HRA_FLOOR_NOT_CONFIGURED")).toBe(false);
    expect(isKnownWarningCode("NOPE")).toBe(false);
    expect(employeeEditHref("a b")).toBe("/hr/employees/a%20b/edit");
  });
});
