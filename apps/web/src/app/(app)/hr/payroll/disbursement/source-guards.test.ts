import { describe, it, expect } from "vitest";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

/**
 * Grep-style guards for GAP-PAYROLL-DISBURSEMENT-05 and -08: these patterns
 * must never come back into this folder's non-test source.
 */
const DIR = __dirname;
const sources = readdirSync(DIR)
  .filter((f) => /\.(ts|tsx)$/.test(f) && !/\.test\.tsx?$/.test(f))
  .map((f) => ({ f, src: readFileSync(join(DIR, f), "utf8") }));

describe("hr/payroll/disbursement source guards", () => {
  it("[DISB-05] has no hard-coded EMP001 sample row", () => {
    expect(sources.filter(({ src }) => src.includes("EMP001")).map(({ f }) => f)).toEqual([]);
  });

  it("[DISB-08] never converts money with Math.round(... * 100)", () => {
    const re = /Math\.round\([^)]*\*\s*100\)/;
    expect(sources.filter(({ src }) => re.test(src)).map(({ f }) => f)).toEqual([]);
  });

  it("[DISB-08] the dead BankFileForm is gone", () => {
    expect(sources.map(({ f }) => f)).not.toContain("BankFileForm.tsx");
  });
});
