import { describe, it, expect } from "vitest";
import enMessages from "@/messages/en.json";
import { deriveExceptions } from "./ExceptionPanel";

// The page passes its `payrollDetail` translator; mirror it from the real catalogue.
const detail = enMessages.payrollDetail as Record<string, string>;
const t = (key: string) => detail[key] ?? `MISSING:${key}`;

describe("deriveExceptions (GAP-PAYROLL-DETAIL-05)", () => {
  it("a slip with MISSING_PAN yields a PAN-specific message", () => {
    const out = deriveExceptions([{ employeeId: "e1", employeeName: "Asha", status: "computed", issues: ["MISSING_PAN"] }], t);
    expect(out).toHaveLength(1);
    expect(out[0]!.issue).toMatch(/PAN is missing/);
    expect(out[0]!.issue).toMatch(/206AA/);
  });

  it("a failed slip with no issue codes still yields the generic calculation message", () => {
    const out = deriveExceptions([{ employeeId: "e2", employeeName: "Ravi", status: "failed" }], t);
    expect(out).toEqual([{ employeeId: "e2", employeeName: "Ravi", issue: detail.exceptionSalaryCalcFailed }]);
  });

  it("combines several problems for one employee into one entry, and ignores healthy slips", () => {
    const out = deriveExceptions(
      [
        { employeeId: "e3", employeeName: "Meena", status: "computed", issues: ["MISSING_BANK_ACCOUNT", "INVALID_IFSC"] },
        { employeeId: "e4", employeeName: "Okay", status: "computed", issues: [] },
      ],
      t,
    );
    expect(out).toHaveLength(1);
    expect(out[0]!.issue).toMatch(/Bank account number is missing/);
    expect(out[0]!.issue).toMatch(/IFSC/);
  });

  it("an issue code it does not know still produces a generic entry rather than being dropped", () => {
    const out = deriveExceptions([{ employeeId: "e5", employeeName: "Z", status: "computed", issues: ["SOMETHING_NEW"] }], t);
    expect(out).toHaveLength(1);
    expect(out[0]!.issue).toBe(detail.exceptionOtherIssue);
  });
});
