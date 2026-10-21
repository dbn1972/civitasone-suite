import { describe, it, expect } from "vitest";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import en from "@/messages/en.json";
import hi from "@/messages/hi.json";

/**
 * GAP-PAYROLL-FORM16-08: the "Back to Payroll" label is translated everywhere under
 * hr/payroll (pages, loading skeletons, error boundaries) via the shared
 * payrollCommon namespace -- never a hard-coded English string literal.
 */
const ROOT = __dirname;

function sources(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) return sources(p);
    return /\.(ts|tsx)$/.test(name) && !/\.test\.(ts|tsx)$/.test(name) ? [p] : [];
  });
}

describe("hr/payroll back labels are not hard-coded English", () => {
  it('no non-test source under hr/payroll contains a quoted "Back to Payroll" / "Back to Salary Slips" / "Payroll Runs" back-label literal', () => {
    const offenders = sources(ROOT).filter((f) => {
      const text = readFileSync(f, "utf8");
      return /backLabel\s*[=:]\s*\{?\s*["'`](?:Back to Payroll|Back to Salary Slips|Payroll Runs)["'`]/.test(text)
        || /["'`]Back to Payroll["'`]/.test(text);
    });
    expect(offenders.map((f) => f.slice(ROOT.length))).toEqual([]);
  });

  it("payrollCommon has both back labels in English and a different, non-empty Hindi translation", () => {
    for (const key of ["backToPayroll", "backToSalarySlips"] as const) {
      expect(en.payrollCommon[key]).toBeTruthy();
      expect(hi.payrollCommon[key]).toBeTruthy();
      expect(hi.payrollCommon[key]).not.toBe(en.payrollCommon[key]);
    }
    expect(en.payrollCommon.backToPayroll).toBe("Back to Payroll");
  });

  it("the run detail page back label is translated too", () => {
    expect(en.payrollDetail.backLabel).toBe("Payroll Runs");
    expect(hi.payrollDetail.backLabel).not.toBe("Payroll Runs");
  });
});
