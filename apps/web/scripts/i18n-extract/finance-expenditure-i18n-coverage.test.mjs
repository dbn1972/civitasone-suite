// UX-017 (tranche 10): regression guard for the finance/expenditure feature's
// i18n slice. Mirrors citizen-i18n-coverage.test.mjs (tranche 1),
// hr-leave-i18n-coverage.test.mjs (tranche 2), and
// finance-pfms-i18n-coverage.test.mjs (tranche 5). Two things are checked,
// independent of each other:
//
//  1. The UX-004 scanner's hardcoded-string count for
//     src/app/(app)/finance/expenditure does not regress above the count
//     left after this tranche. The residual findings are all confirmed --
//     by manual review of every single one, see the tranche-10 commit
//     message -- to be scanner false positives, not real UI text: a
//     BigInt-reduce/ternary/status-lowercase expression sitting directly
//     next to a `return (` reads, to the regex, exactly like the start of a
//     JSX text node. If this test starts failing because the count went
//     *up*, that's the signal to check for a real regression with `--list`.
//
//  2. Every message key referenced by the finance/expenditure namespaces
//     exists in *both* en.json and hi.json (no locale silently falls back to
//     a missing key at runtime).
import { describe, it, expect } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { scanSource } from "./scanner.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const webRoot = path.resolve(__dirname, "..", "..");
const financeExpenditureDir = path.resolve(webRoot, "src/app/(app)/finance/expenditure");

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

const FINANCE_EXPENDITURE_HARDCODED_STRING_CEILING = 10;

describe("finance/expenditure i18n coverage (UX-017 tranche 10)", () => {
  it("does not exceed the known false-positive baseline for hardcoded strings", () => {
    const files = walk(financeExpenditureDir);
    const findings = files.flatMap((file) => scanSource(path.relative(webRoot, file), fs.readFileSync(file, "utf8")));

    if (findings.length > FINANCE_EXPENDITURE_HARDCODED_STRING_CEILING) {
      const extra = findings.slice(FINANCE_EXPENDITURE_HARDCODED_STRING_CEILING).map((f) => `${f.file}:${f.line} ${JSON.stringify(f.text)}`);
      throw new Error(
        `finance/expenditure hardcoded-string count grew from ${FINANCE_EXPENDITURE_HARDCODED_STRING_CEILING} to ${findings.length}. ` +
          `Run \`node scripts/i18n-extract/cli.mjs --dir "src/app/(app)/finance/expenditure" --list\` and translate any genuine ` +
          `new hardcoded string (most residual findings are scanner false positives on BigInt-reduce/ternary/status expressions ` +
          `next to \`return (\` -- see this file's header). New/changed findings include:\n${extra.join("\n")}`,
      );
    }
    expect(findings.length).toBeLessThanOrEqual(FINANCE_EXPENDITURE_HARDCODED_STRING_CEILING);
  });

  it("has no en.json/hi.json key drift for the finance/expenditure namespaces", () => {
    const en = JSON.parse(fs.readFileSync(path.join(webRoot, "src/messages/en.json"), "utf8"));
    const hi = JSON.parse(fs.readFileSync(path.join(webRoot, "src/messages/hi.json"), "utf8"));

    const FINANCE_EXPENDITURE_NAMESPACES = [
      "expenditure",
      "expenditureAdvances",
      "expenditureAdvancesTable",
      "expenditureAdvancesNew",
      "expenditureBills",
      "expenditureBillsTable",
      "expenditureBillDetail",
      "expenditureBillLineItemsTable",
      "expenditureGuarantees",
      "expenditureGuaranteesTable",
      "expenditureSchemeTracking",
      "expenditureSchemeTrackingTable",
      "expenditureSchemeDetail",
      "expenditureUtilizationCertificates",
      "expenditureUtilizationCertificatesTable",
      "expenditureUCNew",
    ];

    function leafKeys(obj, prefix = "") {
      return Object.entries(obj ?? {}).flatMap(([k, v]) => {
        const key = prefix ? `${prefix}.${k}` : k;
        return v && typeof v === "object" && !Array.isArray(v) ? leafKeys(v, key) : [key];
      });
    }

    for (const ns of FINANCE_EXPENDITURE_NAMESPACES) {
      expect(en[ns], `en.json is missing the "${ns}" namespace`).toBeDefined();
      expect(hi[ns], `hi.json is missing the "${ns}" namespace`).toBeDefined();

      const enKeys = leafKeys(en[ns]).sort();
      const hiKeys = leafKeys(hi[ns]).sort();
      expect(hiKeys, `hi.json["${ns}"] keys must match en.json["${ns}"] keys`).toEqual(enKeys);
    }
  });
});
