import { describe, it, expect } from "vitest";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import en from "@/messages/en.json";
import hi from "@/messages/hi.json";

/**
 * GAP-PAYROLL-FORM16-08: every back label under hr/payroll (pages, loading
 * skeletons, error boundaries) is translated -- via the page's own namespace or
 * the shared payrollCommon namespace -- and never a hard-coded English string
 * literal. The guard matches ANY string literal given to a backLabel prop or
 * property, not just a few known phrases.
 */
const ROOT = __dirname;

function sources(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) return sources(p);
    return /\.(ts|tsx)$/.test(name) && !/\.test\.(ts|tsx)$/.test(name) ? [p] : [];
  });
}

/** backLabel="..." | backLabel='...' | backLabel={"..."} | backLabel={`...`} | backLabel: "..." */
const LITERAL_BACK_LABEL = /backLabel\s*[=:]\s*\{?\s*["'`]/;

describe("hr/payroll back labels are not hard-coded English", () => {
  it("no non-test source under hr/payroll gives backLabel a string literal", () => {
    const offenders = sources(ROOT).filter((f) => LITERAL_BACK_LABEL.test(readFileSync(f, "utf8")));
    expect(offenders.map((f) => f.slice(ROOT.length))).toEqual([]);
  });

  it("the guard pattern catches the literal forms it is meant to catch, and not a translated label", () => {
    for (const bad of [
      'backLabel="Back to HR"', "backLabel='Payroll'", 'backLabel={"Payroll"}', "backLabel={`Payroll`}",
      'backLabel: "Back to Pensioners"', 'back="/hr" backLabel = "Anything at all"',
    ]) expect(LITERAL_BACK_LABEL.test(bad), bad).toBe(true);
    for (const ok of ['backLabel={t("backToHr")}', 'backLabel={tCommon("backToPayroll")}', "backLabel={label}", "backLabel,"]) {
      expect(LITERAL_BACK_LABEL.test(ok), ok).toBe(false);
    }
  });

  it("no non-test source under hr/payroll contains a quoted \"Back to Payroll\" literal", () => {
    const offenders = sources(ROOT).filter((f) => /["'`]Back to Payroll["'`]/.test(readFileSync(f, "utf8")));
    expect(offenders.map((f) => f.slice(ROOT.length))).toEqual([]);
  });

  it("payrollCommon has every back label in English and a different, non-empty Hindi translation", () => {
    for (const key of ["backToPayroll", "backToSalarySlips", "backToHr", "backToPensioners"] as const) {
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
