// UX-017 (tranche 11): regression guard for the hr/payroll/{arrears,
// corrections, off-cycle, salary-revisions} i18n slice -- payroll's
// "adjustments & exceptions" cluster (retroactive arrears computation,
// ad-hoc salary corrections, off-cycle bonus/incentive/ad-hoc runs, and
// read-only salary-revision history), grouped by size and theme rather than
// verified code coupling (no cross-imports were found between these four
// sibling directories -- unlike tranche 8's apar/dpc/promotion, which had
// genuine import coupling). payroll/ (~1145 findings / 180 files before
// this tranche) remains too large for one tranche, same conclusion every
// prior tranche reached; these four directories were its largest
// still-untouched *small* sub-directories, together reaching prior
// tranches' usual scale (107 findings / 16 files-with-hits before this
// tranche). Mirrors hr-payroll-disbursement-i18n-coverage.test.mjs
// (tranche 9) and the other per-slice coverage tests it lists. Two things
// are checked, independent of each other:
//
//  1. The UX-004 scanner's combined hardcoded-string count for the four
//     directories does not regress above the count left after this tranche
//     (36 findings, all confirmed -- by manual review of every single one
//     -- to be scanner false positives: TypeScript generic brackets/
//     useState/useRef declarations split across lines, comparison
//     operators (e.g. `r.status === "approved"`) sitting next to a
//     `return (`, or (a new sub-variant of the same "code fragment near a
//     line break" root cause) this tranche's own explanatory code comments
//     getting swept into the match together with the short code fragment
//     immediately before them. None are real UI text. If this test starts
//     failing because the count went *up*, that's the signal to check for
//     a real regression with `--list`.
//
//     Ceiling raised 26 -> 36 (PR #1552 review, UX-017 follow-up):
//     CreateSalaryRevisionForm.tsx converted to next-intl
//     (useTranslations("createSalaryRevisionForm") + an `invalidField`
//     identity replacing message-string comparisons -- see its own header
//     comment) added several new useState/useRef declarations and a
//     `Record<RevisionType, string>` generic. Verified with `--list`: all 10
//     new findings in that file (plus one pre-existing, unrelated
//     page.tsx:24 false positive merely shifted past the old ceiling index)
//     are the exact same useState/useRef/generic-declaration code-fragment
//     class documented above -- zero real hardcoded UI text among them.
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
const SLICE_DIRS = ["arrears", "corrections", "off-cycle", "salary-revisions"].map((d) =>
  path.resolve(webRoot, "src/app/(app)/hr/payroll", d),
);

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

const HR_PAYROLL_ADJUSTMENTS_HARDCODED_STRING_CEILING = 36;

describe("hr/payroll/{arrears,corrections,off-cycle,salary-revisions} i18n coverage (UX-017 tranche 11)", () => {
  it("does not exceed the known false-positive baseline for hardcoded strings", () => {
    const files = SLICE_DIRS.flatMap((dir) => walk(dir));
    const findings = files.flatMap((file) => scanSource(path.relative(webRoot, file), fs.readFileSync(file, "utf8")));

    if (findings.length > HR_PAYROLL_ADJUSTMENTS_HARDCODED_STRING_CEILING) {
      const extra = findings.slice(HR_PAYROLL_ADJUSTMENTS_HARDCODED_STRING_CEILING).map((f) => `${f.file}:${f.line} ${JSON.stringify(f.text)}`);
      throw new Error(
        `hr/payroll adjustments-slice hardcoded-string count grew from ${HR_PAYROLL_ADJUSTMENTS_HARDCODED_STRING_CEILING} to ${findings.length}. ` +
          `Run \`node scripts/i18n-extract/cli.mjs --dir "src/app/(app)/hr/payroll/<arrears|corrections|off-cycle|salary-revisions>" --list\` and translate any genuine new ` +
          `hardcoded string (most residual findings are scanner false positives on TS generics/useState-useRef declarations/comparison-operator code fragments -- see this file's header). ` +
          `New/changed findings include:\n${extra.join("\n")}`,
      );
    }
    expect(findings.length).toBeLessThanOrEqual(HR_PAYROLL_ADJUSTMENTS_HARDCODED_STRING_CEILING);
  });

  it("has no en.json/hi.json key drift for this slice's namespaces", () => {
    const en = JSON.parse(fs.readFileSync(path.join(webRoot, "src/messages/en.json"), "utf8"));
    const hi = JSON.parse(fs.readFileSync(path.join(webRoot, "src/messages/hi.json"), "utf8"));

    const HR_PAYROLL_ADJUSTMENTS_NAMESPACES = [
      "arrears",
      "corrections",
      "createCorrectionForm",
      "offCycle",
      "createOffCycleForm",
      "offCycleCard",
      "offCycleList",
      "salaryRevisions",
      "createSalaryRevisionForm",
    ];

    function leafKeys(obj, prefix = "") {
      return Object.entries(obj ?? {}).flatMap(([k, v]) => {
        const key = prefix ? `${prefix}.${k}` : k;
        return v && typeof v === "object" && !Array.isArray(v) ? leafKeys(v, key) : [key];
      });
    }

    for (const ns of HR_PAYROLL_ADJUSTMENTS_NAMESPACES) {
      expect(en[ns], `en.json is missing the "${ns}" namespace`).toBeDefined();
      expect(hi[ns], `hi.json is missing the "${ns}" namespace`).toBeDefined();

      const enKeys = leafKeys(en[ns]).sort();
      const hiKeys = leafKeys(hi[ns]).sort();
      expect(hiKeys, `hi.json["${ns}"] keys must match en.json["${ns}"] keys`).toEqual(enKeys);
    }
  });
});
