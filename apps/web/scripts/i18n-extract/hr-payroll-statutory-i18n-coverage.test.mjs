// UX-017 (tranche 12): regression guard for the hr/payroll/statutory i18n
// slice -- the "statutory fund ledgers & configs" cluster (PF/EPF, GPF, NPS,
// ESI, Gratuity, LWF, and Professional Tax, plus the statutory hub page and
// its StatutoryComplianceCard summary tiles). statutory/ (210 findings / 35
// files before this tranche) was flagged by tranche 11's own closing note as
// "worth checking for its own internal structure before committing to it as
// a single slice" -- surveyed its 9 internal sub-directories individually
// (challans 31, esi 12, gpf 11, gratuity 24, lwf 22, nps 11, perquisite 45,
// pf 20, pt 24, plus 10 in the hub's own root files) and split it in two:
// this tranche covers the 7 read-only-ledger/config-form sub-directories
// (pf, gpf, nps, esi, gratuity, lwf, pt) and the hub root, leaving the two
// most complex remaining pieces -- challans/ (TDS ingestion + reconciliation)
// and perquisite/ (Form 12BA) -- for a follow-up tranche, same "split a
// too-large module" precedent as tranche 5/10 vs. tranche 11's grouping.
// Mirrors hr-payroll-adjustments-i18n-coverage.test.mjs (tranche 11) and the
// other per-slice coverage tests it lists. Two things are checked,
// independent of each other:
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
const STATUTORY_ROOT = path.resolve(webRoot, "src/app/(app)/hr/payroll/statutory");
// challans/ and perquisite/ are deliberately NOT part of this slice (left for
// a follow-up tranche) -- only the hub root's own files plus these 7
// sub-directories are in scope here.
const STATUTORY_SUBDIRS = ["pf", "gpf", "nps", "esi", "gratuity", "lwf", "pt"].map((d) =>
  path.join(STATUTORY_ROOT, d),
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

// The statutory hub root also contains challans/ and perquisite/ as
// sub-directories -- list its own direct files only, not a recursive walk,
// so this slice never silently swallows those two untouched directories.
function directFilesOnly(dir) {
  return fs
    .readdirSync(dir, { withFileTypes: true })
    .filter((e) => e.isFile() && INCLUDE_EXT_RE.test(e.name) && !SKIP_FILE_RE.test(e.name))
    .map((e) => path.join(dir, e.name));
}

const SLICE_FILES = [...directFilesOnly(STATUTORY_ROOT), ...STATUTORY_SUBDIRS.flatMap((dir) => walk(dir))];

// Re-scanned fresh after translating (pf 4, gpf 1, nps 1, esi 1, gratuity 3,
// lwf 4, pt 5, hub root 0 = 19 total) -- every one individually reviewed and
// confirmed a scanner false positive: TS generic brackets on useState/useId/
// useRef/Promise<...> declarations split across lines, a comparison-operator
// fragment (`0 && numYears`, `) : rows.length === 0 ? (`) sitting next to a
// JSX tag, and the tranche-11-documented sub-variant where this tranche's own
// explanatory code comments (the invalidField bugfix note in LwfConfigForm.tsx
// /PtSlabForm.tsx) get swept into the same match as the code fragment right
// after them. None are real remaining UI text.
const HR_PAYROLL_STATUTORY_HARDCODED_STRING_CEILING = 19;

describe("hr/payroll/statutory (pf/gpf/nps/esi/gratuity/lwf/pt + hub root) i18n coverage (UX-017 tranche 12)", () => {
  it("does not exceed the known false-positive baseline for hardcoded strings", () => {
    const findings = SLICE_FILES.flatMap((file) => scanSource(path.relative(webRoot, file), fs.readFileSync(file, "utf8")));

    if (findings.length > HR_PAYROLL_STATUTORY_HARDCODED_STRING_CEILING) {
      const extra = findings.slice(HR_PAYROLL_STATUTORY_HARDCODED_STRING_CEILING).map((f) => `${f.file}:${f.line} ${JSON.stringify(f.text)}`);
      throw new Error(
        `hr/payroll/statutory-slice hardcoded-string count grew from ${HR_PAYROLL_STATUTORY_HARDCODED_STRING_CEILING} to ${findings.length}. ` +
          `Run \`node scripts/i18n-extract/cli.mjs --dir "src/app/(app)/hr/payroll/statutory/<pf|gpf|nps|esi|gratuity|lwf|pt>" --list\` (or --dir ` +
          `"src/app/(app)/hr/payroll/statutory" for the hub root files) and translate any genuine new hardcoded string (most residual findings are ` +
          `scanner false positives on TS generics/useState-useRef declarations/comparison-operator code fragments -- see this file's header). ` +
          `New/changed findings include:\n${extra.join("\n")}`,
      );
    }
    expect(findings.length).toBeLessThanOrEqual(HR_PAYROLL_STATUTORY_HARDCODED_STRING_CEILING);
  });

  it("has no en.json/hi.json key drift for this slice's namespaces", () => {
    const en = JSON.parse(fs.readFileSync(path.join(webRoot, "src/messages/en.json"), "utf8"));
    const hi = JSON.parse(fs.readFileSync(path.join(webRoot, "src/messages/hi.json"), "utf8"));

    const HR_PAYROLL_STATUTORY_NAMESPACES = [
      "statutory",
      "statutoryComplianceCard",
      "esi",
      "gpf",
      "nps",
      "gratuity",
      "gratuityCalculator",
      "lwf",
      "lwfConfigForm",
      "pf",
      "ecrGeneratorForm",
      "pt",
      "ptSlabForm",
    ];

    function leafKeys(obj, prefix = "") {
      return Object.entries(obj ?? {}).flatMap(([k, v]) => {
        const key = prefix ? `${prefix}.${k}` : k;
        return v && typeof v === "object" && !Array.isArray(v) ? leafKeys(v, key) : [key];
      });
    }

    for (const ns of HR_PAYROLL_STATUTORY_NAMESPACES) {
      expect(en[ns], `en.json is missing the "${ns}" namespace`).toBeDefined();
      expect(hi[ns], `hi.json is missing the "${ns}" namespace`).toBeDefined();

      const enKeys = leafKeys(en[ns]).sort();
      const hiKeys = leafKeys(hi[ns]).sort();
      expect(hiKeys, `hi.json["${ns}"] keys must match en.json["${ns}"] keys`).toEqual(enKeys);
    }
  });
});
