// UX-017 (tranche 9): regression guard for the hr/payroll/disbursement
// sub-module's i18n slice. payroll/ (~1236 findings / 180 files) is
// confirmed too large for one tranche by every prior tranche's own
// assessment (same as tranche 8 found for the rest of hr/); disbursement/
// is payroll's own largest well-scoped internal sub-directory (126 findings
// / 9 files with hits before this tranche -- the next largest, flex-benefits,
// was only 52), a single cohesive feature (employee bank transfers, NACH
// mandates, bank file generation, DSC signing), comparable in scale to
// tranche 4/6/7/8's single-module slices. Mirrors
// hr-apar-dpc-promotion-i18n-coverage.test.mjs (tranche 8),
// hr-employees-i18n-coverage.test.mjs (tranche 7),
// hr-workforce-i18n-coverage.test.mjs (tranche 6),
// finance-pfms-i18n-coverage.test.mjs (tranche 5), and
// hr-leave-i18n-coverage.test.mjs (tranche 2). Two things are checked,
// independent of each other:
//
//  1. The UX-004 scanner's hardcoded-string count for
//     src/app/(app)/hr/payroll/disbursement does not regress above the
//     count left after this tranche (35 findings, all confirmed -- by
//     manual review of every single one -- to be scanner false positives,
//     not real UI text: TypeScript generic brackets (`useState<T>()`,
//     `useRef<T>(null)`, `Record<...>`, `Promise<T>`) or comparison
//     operators (`tx.status === "failed"`, `eligibleRuns.length === 0`)
//     sitting near a real JSX closing tag or comment, reading to the regex
//     exactly like real tracked patterns. If this test starts failing
//     because the count went *up*, that's the signal to check for a real
//     regression with `--list`.
//
//  2. Every message key referenced by the disbursement-slice namespaces
//     exists in *both* en.json and hi.json (no locale silently falls back
//     to a missing key at runtime).
import { describe, it, expect } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { scanSource } from "./scanner.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const webRoot = path.resolve(__dirname, "..", "..");
const disbursementDir = path.resolve(webRoot, "src/app/(app)/hr/payroll/disbursement");

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

const HR_PAYROLL_DISBURSEMENT_HARDCODED_STRING_CEILING = 35;

describe("hr/payroll/disbursement i18n coverage (UX-017 tranche 9)", () => {
  it("does not exceed the known false-positive baseline for hardcoded strings", () => {
    const files = walk(disbursementDir);
    const findings = files.flatMap((file) => scanSource(path.relative(webRoot, file), fs.readFileSync(file, "utf8")));

    if (findings.length > HR_PAYROLL_DISBURSEMENT_HARDCODED_STRING_CEILING) {
      const extra = findings.slice(HR_PAYROLL_DISBURSEMENT_HARDCODED_STRING_CEILING).map((f) => `${f.file}:${f.line} ${JSON.stringify(f.text)}`);
      throw new Error(
        `hr/payroll/disbursement hardcoded-string count grew from ${HR_PAYROLL_DISBURSEMENT_HARDCODED_STRING_CEILING} to ${findings.length}. ` +
          `Run \`node scripts/i18n-extract/cli.mjs --dir "src/app/(app)/hr/payroll/disbursement" --list\` and translate any genuine new ` +
          `hardcoded string (most residual findings are scanner false positives on TS generics/comparison-operator code fragments -- see this file's header). ` +
          `New/changed findings include:\n${extra.join("\n")}`,
      );
    }
    expect(findings.length).toBeLessThanOrEqual(HR_PAYROLL_DISBURSEMENT_HARDCODED_STRING_CEILING);
  });

  it("has no en.json/hi.json key drift for the hr/payroll/disbursement namespaces", () => {
    const en = JSON.parse(fs.readFileSync(path.join(webRoot, "src/messages/en.json"), "utf8"));
    const hi = JSON.parse(fs.readFileSync(path.join(webRoot, "src/messages/hi.json"), "utf8"));

    const HR_PAYROLL_DISBURSEMENT_NAMESPACES = [
      "disbursement",
      "disbursementTransferTable",
      "bankFileWizard",
      "nachMandateForm",
      "nachReturnForm",
      "sponsorBankConfigForm",
      "dscConfigForm",
      "bankFileForm",
    ];

    function leafKeys(obj, prefix = "") {
      return Object.entries(obj ?? {}).flatMap(([k, v]) => {
        const key = prefix ? `${prefix}.${k}` : k;
        return v && typeof v === "object" && !Array.isArray(v) ? leafKeys(v, key) : [key];
      });
    }

    for (const ns of HR_PAYROLL_DISBURSEMENT_NAMESPACES) {
      expect(en[ns], `en.json is missing the "${ns}" namespace`).toBeDefined();
      expect(hi[ns], `hi.json is missing the "${ns}" namespace`).toBeDefined();

      const enKeys = leafKeys(en[ns]).sort();
      const hiKeys = leafKeys(hi[ns]).sort();
      expect(hiKeys, `hi.json["${ns}"] keys must match en.json["${ns}"] keys`).toEqual(enKeys);
    }
  });
});
