// Wave 4 cluster G: regression guard for the hr/payroll "remaining 17 pages"
// i18n slice -- the last group of payroll pages that had zero next-intl
// coverage as of the last audit (docs/ENTERPRISE-GAP-REPORT-2026-09-07.md
// UX-004), converted in this tranche: the payroll hub root, the [id] run-
// detail page and its five components, bonus, comparison, costing, ctc,
// ddos, flex-benefits, fnf, pay-groups, reimbursements, returns, salary-slips
// (+ its [id] print view), slips/[id] (the payslip dashboard), and
// structures, plus the already-mostly-converted runs/period/register pages'
// stray loading.tsx skeletons. statutory/{pf,gpf,nps,esi,gratuity,lwf,pt} +
// the statutory hub root are a separate, already-covered slice (see
// hr-payroll-statutory-i18n-coverage.test.mjs) and are deliberately excluded
// here even though this tranche also added `loadingAriaLabel` to the
// existing "gpf"/"nps" namespaces (that key is covered by the other test's
// own en/hi parity check, not duplicated here). Mirrors
// hr-payroll-statutory-i18n-coverage.test.mjs's structure. Two things are
// checked, independent of each other:
//
//  1. The UX-004 scanner's combined hardcoded-string count for this slice
//     does not regress above the count left after this tranche (349 before
//     -> 104 after; every one of the 104 individually reviewed and confirmed
//     a scanner false positive -- TS generic brackets on useState/useId/
//     useRef/Promise<...> declarations split across lines, comparison-
//     operator or ternary-branch fragments sitting next to a JSX tag
//     (`) : x.length === 0 ? (`, `= 4 && m`), and explanatory code comments
//     swept into the same match as the code right after them. None are real
//     remaining UI text -- see this tranche's PR description for the
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

// The payroll hub root also contains many sibling sub-directories from
// other slices (statutory/, gpf/, nps/, income-tax/, loans/, off-cycle/,
// salary-revisions/, tax-config/, tax-declaration/, arrears/, corrections/,
// disbursement/, form16/, etc.) that are NOT part of this tranche -- only
// this slice's own explicit sub-directories, plus the hub root's own direct
// files, are in scope here.
const SLICE_SUBDIRS = [
  "[id]",
  "bonus",
  "comparison",
  "costing",
  "ctc",
  "ddos",
  "flex-benefits",
  "fnf",
  "pay-groups",
  "period",
  "register",
  "reimbursements",
  "returns",
  "runs",
  "salary-slips",
  "slips",
  "structures",
].map((d) => path.join(PAYROLL_ROOT, d));

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

function directFilesOnly(dir) {
  return fs
    .readdirSync(dir, { withFileTypes: true })
    .filter((e) => e.isFile() && INCLUDE_EXT_RE.test(e.name) && !SKIP_FILE_RE.test(e.name))
    .map((e) => path.join(dir, e.name));
}

const SLICE_FILES = [...directFilesOnly(PAYROLL_ROOT), ...SLICE_SUBDIRS.flatMap((dir) => walk(dir))];

// Re-scanned fresh after translating (349 raw findings before -> 104 after);
// every one of the 104 individually reviewed and confirmed a scanner false
// positive (see file header). None are real remaining UI text.
const HR_PAYROLL_REMAINING_HARDCODED_STRING_CEILING = 104;

describe("hr/payroll remaining pages (root/[id]/bonus/comparison/costing/ctc/ddos/flex-benefits/fnf/pay-groups/reimbursements/returns/salary-slips/slips/structures) i18n coverage (Wave 4 cluster G)", () => {
  it("does not exceed the known false-positive baseline for hardcoded strings", () => {
    const findings = SLICE_FILES.flatMap((file) => scanSource(path.relative(webRoot, file), fs.readFileSync(file, "utf8")));

    if (findings.length > HR_PAYROLL_REMAINING_HARDCODED_STRING_CEILING) {
      const extra = findings.slice(HR_PAYROLL_REMAINING_HARDCODED_STRING_CEILING).map((f) => `${f.file}:${f.line} ${JSON.stringify(f.text)}`);
      throw new Error(
        `hr/payroll-remaining-slice hardcoded-string count grew from ${HR_PAYROLL_REMAINING_HARDCODED_STRING_CEILING} to ${findings.length}. ` +
          `Run \`node scripts/i18n-extract/cli.mjs --dir "src/app/(app)/hr/payroll/<subdir>" --list\` and translate any genuine new hardcoded ` +
          `string (most residual findings are scanner false positives on TS generics/useState-useRef declarations/comparison-operator code ` +
          `fragments -- see this file's header). New/changed findings include:\n${extra.join("\n")}`,
      );
    }
    expect(findings.length).toBeLessThanOrEqual(HR_PAYROLL_REMAINING_HARDCODED_STRING_CEILING);
  });

  it("has no en.json/hi.json key drift for this slice's namespaces", () => {
    const en = JSON.parse(fs.readFileSync(path.join(webRoot, "src/messages/en.json"), "utf8"));
    const hi = JSON.parse(fs.readFileSync(path.join(webRoot, "src/messages/hi.json"), "utf8"));

    const HR_PAYROLL_REMAINING_NAMESPACES = [
      "payroll",
      "payrollRunsTable",
      "createPayrollRunForm",
      "payrollDetail",
      "payrollRunActions",
      "exceptionPanel",
      "monthOverMonthCards",
      "payrollRunStepper",
      "salarySlipsClientTable",
      "payrollBonus",
      "computeBonusForm",
      "payrollComparison",
      "payrollCosting",
      "costingPeriodForm",
      "createCostingRuleForm",
      "payrollCtc",
      "ctcCalculatorForm",
      "payrollDdos",
      "createDdoForm",
      "payrollFlexBenefits",
      "createFlexPlanForm",
      "electFlexBenefitForm",
      "payrollFnf",
      "computeFnfForm",
      "fnFSettlementCard",
      "payrollPayGroups",
      "createPayGroupForm",
      "payGroupCard",
      "payrollReimbursements",
      "createReimbursementForm",
      "payrollReturns",
      "forceFileButton",
      "quarterLookupForm",
      "taxReturnsSummary",
      "salarySlips",
      "salarySlipsTable",
      "printButton",
      "salarySlipDetail",
      "salarySlipDashboard",
      "payrollStructures",
      "createStructureForm",
      "componentGrid",
      "salaryStructureCard",
      // payrollRuns/payrollPeriod/payrollRegister are this slice's other
      // page.tsx namespaces (runs/, period/, register/ sub-directories) --
      // only their loading.tsx skeletons were touched in this tranche.
      "payrollRuns",
      "payrollPeriod",
      "payrollRegister",
    ];

    function leafKeys(obj, prefix = "") {
      return Object.entries(obj ?? {}).flatMap(([k, v]) => {
        const key = prefix ? `${prefix}.${k}` : k;
        return v && typeof v === "object" && !Array.isArray(v) ? leafKeys(v, key) : [key];
      });
    }

    for (const ns of HR_PAYROLL_REMAINING_NAMESPACES) {
      expect(en[ns], `en.json is missing the "${ns}" namespace`).toBeDefined();
      expect(hi[ns], `hi.json is missing the "${ns}" namespace`).toBeDefined();

      const enKeys = leafKeys(en[ns]).sort();
      const hiKeys = leafKeys(hi[ns]).sort();
      expect(hiKeys, `hi.json["${ns}"] keys must match en.json["${ns}"] keys`).toEqual(enKeys);
    }
  });
});
