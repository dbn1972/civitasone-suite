// UX-017 (tranche 14): regression guard for the hr/payroll income-tax/
// tax-declaration/form16 i18n slice. payroll/ (892 findings before this
// tranche, re-derived fresh via the scanner rather than trusted from the
// gap-report -- tranche 13's own closing note listed the remaining
// non-statutory sub-directories to survey) was the largest well-defined
// remaining pocket fleet-wide (bigger than finance/'s 808, which despite
// looking untouched in the gap-report text had actually already had two
// tranches -- 5 and 10 -- confirmed via real git history before relying on
// it). Of payroll's 27 untouched sub-directories, income-tax (11 findings/2
// files), tax-declaration (25 findings/3 files) and form16 (61 findings/6
// files) form one coherent "income tax / Form-16" cluster -- 97 findings
// total, in line with prior tranches' per-slice sizing (76-140).
// Mirrors hr-payroll-statutory-challans-perquisite-i18n-coverage.test.mjs
// (tranche 13) and the other per-slice coverage tests it lists. Two things
// are checked, independent of each other:
//
//  1. The UX-004 scanner's combined hardcoded-string count for this slice
//     does not regress above the count left after this tranche (confirmed
//     false positives only -- see this tranche's PR description for the
//     per-file breakdown). If this test starts failing because the count
//     went *up*, that's the signal to check for a real regression with
//     `--list`.
//
//  2. Every message key referenced by this slice's namespaces exists in
//     *both* en.json and hi.json (no locale silently falls back to a
//     missing key at runtime).
import { describe, it, expect } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { scanSource } from "./scanner.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const webRoot = path.resolve(__dirname, "..", "..");
const PAYROLL_ROOT = path.resolve(webRoot, "src/app/(app)/hr/payroll");
const SLICE_SUBDIRS = ["income-tax", "tax-declaration", "form16"].map((d) => path.join(PAYROLL_ROOT, d));

const SKIP_DIRS = new Set(["node_modules", ".next", "__fixtures__"]);
const SKIP_FILE_RE = /\.(test|stories|spec)\.[jt]sx?$/;
const INCLUDE_EXT_RE = /\.(tsx|jsx)$/;

function walk(dir, out = []) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (SKIP_DIRS.has(entry.name)) continue;
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) walk(full, out);
    else if (INCLUDE_EXT_RE.test(entry.name) && !SKIP_FILE_RE.test(entry.name)) out.push(full);
  }
  return out;
}

const SLICE_FILES = SLICE_SUBDIRS.flatMap((dir) => walk(dir));

// Re-scanned fresh after translating (income-tax 1, tax-declaration 2,
// form16 14 = 17 total) -- every one individually reviewed and confirmed a
// scanner false positive: TS generic brackets on useState/useId/useRef
// declarations split across lines, two comparison-operator fragments
// (`) : lookup.state === "error" ? (`, `0 && lookup.job.errorDetails != null
// && (`) sitting next to a JSX tag, and the tranche-12/13-documented
// sub-variant where this tranche's own explanatory code comment (the
// invalidField bugfix note in GenerateForm16Form.tsx) gets swept into the
// same match as the useState declaration right after it. None are real
// remaining UI text.
const HR_PAYROLL_INCOME_TAX_FORM16_HARDCODED_STRING_CEILING = 17;

describe("hr/payroll income-tax/tax-declaration/form16 i18n coverage (UX-017 tranche 14)", () => {
  it("does not exceed the known false-positive baseline for hardcoded strings", () => {
    const findings = SLICE_FILES.flatMap((file) => scanSource(path.relative(webRoot, file), fs.readFileSync(file, "utf8")));

    if (findings.length > HR_PAYROLL_INCOME_TAX_FORM16_HARDCODED_STRING_CEILING) {
      const extra = findings.slice(HR_PAYROLL_INCOME_TAX_FORM16_HARDCODED_STRING_CEILING).map((f) => `${f.file}:${f.line} ${JSON.stringify(f.text)}`);
      throw new Error(
        `hr/payroll income-tax/tax-declaration/form16 hardcoded-string count grew from ${HR_PAYROLL_INCOME_TAX_FORM16_HARDCODED_STRING_CEILING} to ${findings.length}. ` +
          `Run \`node scripts/i18n-extract/cli.mjs --dir "src/app/(app)/hr/payroll/<income-tax|tax-declaration|form16>" --list\` and translate any genuine new ` +
          `hardcoded string (most residual findings are scanner false positives on TS generics/useState-useRef declarations/comparison-operator code ` +
          `fragments -- see this file's header). New/changed findings include:\n${extra.join("\n")}`,
      );
    }
    expect(findings.length).toBeLessThanOrEqual(HR_PAYROLL_INCOME_TAX_FORM16_HARDCODED_STRING_CEILING);
  });

  it("has no en.json/hi.json key drift for this slice's namespaces", () => {
    const en = JSON.parse(fs.readFileSync(path.join(webRoot, "src/messages/en.json"), "utf8"));
    const hi = JSON.parse(fs.readFileSync(path.join(webRoot, "src/messages/hi.json"), "utf8"));

    const SLICE_NAMESPACES = [
      "incomeTax",
      "taxDeclaration",
      "taxDeclarationForm",
      "form16",
      "fyLookupForm",
      "form16Wizard",
      "generateForm16Form",
      "verifyForm16Form",
    ];

    function leafKeys(obj, prefix = "") {
      return Object.entries(obj ?? {}).flatMap(([k, v]) => {
        const key = prefix ? `${prefix}.${k}` : k;
        return v && typeof v === "object" && !Array.isArray(v) ? leafKeys(v, key) : [key];
      });
    }

    for (const ns of SLICE_NAMESPACES) {
      expect(en[ns], `en.json is missing the "${ns}" namespace`).toBeDefined();
      expect(hi[ns], `hi.json is missing the "${ns}" namespace`).toBeDefined();

      const enKeys = leafKeys(en[ns]).sort();
      const hiKeys = leafKeys(hi[ns]).sort();
      expect(hiKeys, `hi.json["${ns}"] keys must match en.json["${ns}"] keys`).toEqual(enKeys);
    }
  });
});
