// UX-017 (tranche 15): regression guard for the hr/payroll loans/gpf/nps/
// pensioners i18n slice ("retiral benefits" cluster). Fresh scan before
// starting (fleet-wide 13796, matching tranche 14's own closing count
// exactly -- confirming no other i18n work landed on payroll/ meanwhile):
// loans 49/5 files, gpf 17/1 file, nps 18/1 file, pensioners 41/5 files =
// 125 findings / 12 files, in line with prior tranches' per-slice sizing
// (76-140) and matching tranche 14's own suggested "retiral benefits"
// grouping exactly.
// Mirrors hr-payroll-income-tax-tax-declaration-form16-i18n-coverage.test.mjs
// (tranche 14) and the other per-slice coverage tests it lists. Two things
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
const SLICE_SUBDIRS = ["loans", "gpf", "nps", "pensioners"].map((d) => path.join(PAYROLL_ROOT, d));

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

// Re-scanned fresh after translating (loans 10, gpf 1, nps 2, pensioners 1 =
// 14 total) -- every residual finding individually reviewed and confirmed a
// scanner false positive: TS generic brackets on useState/useId/useRef
// declarations split across lines by the regex (e.g. CreateLoanForm.tsx's
// `useState<string | undefined>()`/`useRef<HTMLInputElement>(null)` chain,
// LoansTable.tsx's `useState<string | undefined>()`,
// CreatePensionerForm.tsx's `useState<"old" | "new">("new")`), and
// comparison-operator/reduce-callback fragments sitting next to a JSX tag
// (e.g. `row.status === "applied" ? (`, `) : tableRows.length === 0 ? (`,
// the `.reduce((s, l) => s + Number(...), 0)` callback bodies immediately
// preceding a `return (`). None are real remaining UI text.
const HR_PAYROLL_LOANS_GPF_NPS_PENSIONERS_HARDCODED_STRING_CEILING = 14;

describe("hr/payroll loans/gpf/nps/pensioners i18n coverage (UX-017 tranche 15)", () => {
  it("does not exceed the known false-positive baseline for hardcoded strings", () => {
    const findings = SLICE_FILES.flatMap((file) => scanSource(path.relative(webRoot, file), fs.readFileSync(file, "utf8")));

    if (findings.length > HR_PAYROLL_LOANS_GPF_NPS_PENSIONERS_HARDCODED_STRING_CEILING) {
      const extra = findings.slice(HR_PAYROLL_LOANS_GPF_NPS_PENSIONERS_HARDCODED_STRING_CEILING).map((f) => `${f.file}:${f.line} ${JSON.stringify(f.text)}`);
      throw new Error(
        `hr/payroll loans/gpf/nps/pensioners hardcoded-string count grew from ${HR_PAYROLL_LOANS_GPF_NPS_PENSIONERS_HARDCODED_STRING_CEILING} to ${findings.length}. ` +
          `Run \`node scripts/i18n-extract/cli.mjs --dir "src/app/(app)/hr/payroll/<loans|gpf|nps|pensioners>" --list\` and translate any genuine new ` +
          `hardcoded string (most residual findings are scanner false positives on TS generics/useState-useId-useRef declarations/comparison-operator code ` +
          `fragments -- see this file's header). New/changed findings include:\n${extra.join("\n")}`,
      );
    }
    expect(findings.length).toBeLessThanOrEqual(HR_PAYROLL_LOANS_GPF_NPS_PENSIONERS_HARDCODED_STRING_CEILING);
  });

  it("has no en.json/hi.json key drift for this slice's namespaces", () => {
    const en = JSON.parse(fs.readFileSync(path.join(webRoot, "src/messages/en.json"), "utf8"));
    const hi = JSON.parse(fs.readFileSync(path.join(webRoot, "src/messages/hi.json"), "utf8"));

    const SLICE_NAMESPACES = [
      "payrollLoans",
      "loanSearchForm",
      "loansTable",
      "createLoanForm",
      "gpfStatements",
      "npsStatements",
      "pensioners",
      "pensionersNew",
      "createPensionerForm",
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
