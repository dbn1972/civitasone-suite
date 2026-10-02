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

  // Review D1 (GAP-PAYROLL-DISBURSEMENT-TRANSFERS): page.tsx called
  // toClientTransferRow() from a "use client" module -- a client reference on
  // the server, which throws at request time in Next 14 as soon as a row
  // exists. A server module may take only components (PascalCase, rendered as
  // JSX) and types from a "use client" sibling, never a function to call.
  it("[TRANSFERS D1] no server module imports a callable (non-component) value from a \"use client\" sibling", () => {
    const isClient = (name: string): boolean => {
      for (const ext of [".tsx", ".ts"]) {
        try {
          return /^\s*["']use client["']/.test(readFileSync(join(DIR, name + ext), "utf8"));
        } catch { /* try next extension */ }
      }
      return false;
    };
    const offenders: string[] = [];
    for (const { f, src } of sources) {
      if (/^\s*["']use client["']/.test(src)) continue;
      const re = /import\s+(type\s+)?\{([^}]*)\}\s+from\s+["']\.\/([^"']+)["']/g;
      for (const m of src.matchAll(re)) {
        if (m[1] || !isClient(m[3]!)) continue;
        for (const spec of m[2]!.split(",").map((x) => x.trim()).filter(Boolean)) {
          if (spec.startsWith("type ")) continue;
          const local = spec.split(/\s+as\s+/).pop()!;
          if (!/^[A-Z]/.test(local)) offenders.push(`${f}: ${spec} from ./${m[3]}`);
        }
      }
    }
    expect(offenders).toEqual([]);
  });

  it("[DISB-08] the dead BankFileForm is gone", () => {
    expect(sources.map(({ f }) => f)).not.toContain("BankFileForm.tsx");
  });
});
