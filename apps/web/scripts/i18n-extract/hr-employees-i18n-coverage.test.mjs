// UX-017 (tranche 7): regression guard for the hr/employees + hr/employee-types
// sub-modules' i18n slice. Mirrors hr-leave-i18n-coverage.test.mjs (tranche 2),
// finance-pfms-i18n-coverage.test.mjs (tranche 5), and
// hr-workforce-i18n-coverage.test.mjs (tranche 6). Two things are checked,
// independent of each other:
//
//  1. The UX-004 scanner's hardcoded-string count for src/app/(app)/hr/employees
//     and src/app/(app)/hr/employee-types does not regress above the count left
//     after this tranche (17 + 2 = 19 findings, all confirmed -- by manual
//     review of every single one, see the tranche-7 commit message -- to be
//     scanner false positives, not real UI text: a `<` used as a TypeScript
//     generic bracket (`useState<...>`, `Record<...>`, `Promise<...>`) or a
//     ternary conditional-render chain (`) : x ? (`) sitting near a real JSX
//     closing tag reads, to the regex, exactly like real tracked patterns.
//     If this test starts failing because the count went *up*, that's the
//     signal to check for a real regression with `--list`.
//
//  2. Every message key referenced by the employees/employee-types namespaces
//     exists in *both* en.json and hi.json (no locale silently falls back to
//     a missing key at runtime). This includes the pre-existing "employees"
//     namespace this tranche extended, not just the four it created.
import { describe, it, expect } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { scanSource } from "./scanner.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const webRoot = path.resolve(__dirname, "..", "..");
const hrEmployeesDir = path.resolve(webRoot, "src/app/(app)/hr/employees");
const hrEmployeeTypesDir = path.resolve(webRoot, "src/app/(app)/hr/employee-types");

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

const HR_EMPLOYEES_HARDCODED_STRING_CEILING = 19; // 17 (employees/) + 2 (employee-types/)

describe("hr/employees + hr/employee-types i18n coverage (UX-017 tranche 7)", () => {
  it("does not exceed the known false-positive baseline for hardcoded strings", () => {
    const files = [...walk(hrEmployeesDir), ...walk(hrEmployeeTypesDir)];
    const findings = files.flatMap((file) => scanSource(path.relative(webRoot, file), fs.readFileSync(file, "utf8")));

    if (findings.length > HR_EMPLOYEES_HARDCODED_STRING_CEILING) {
      const extra = findings.slice(HR_EMPLOYEES_HARDCODED_STRING_CEILING).map((f) => `${f.file}:${f.line} ${JSON.stringify(f.text)}`);
      throw new Error(
        `hr/employees + hr/employee-types hardcoded-string count grew from ${HR_EMPLOYEES_HARDCODED_STRING_CEILING} to ${findings.length}. ` +
          `Run \`node scripts/i18n-extract/cli.mjs --dir "src/app/(app)/hr/employees" --list\` (and the same for employee-types) and translate any ` +
          `genuine new hardcoded string (most residual findings are scanner false positives on TS generics/ternaries -- see this file's header). ` +
          `New/changed findings include:\n${extra.join("\n")}`,
      );
    }
    expect(findings.length).toBeLessThanOrEqual(HR_EMPLOYEES_HARDCODED_STRING_CEILING);
  });

  it("has no en.json/hi.json key drift for the hr/employees + hr/employee-types namespaces", () => {
    const en = JSON.parse(fs.readFileSync(path.join(webRoot, "src/messages/en.json"), "utf8"));
    const hi = JSON.parse(fs.readFileSync(path.join(webRoot, "src/messages/hi.json"), "utf8"));

    const HR_EMPLOYEES_NAMESPACES = [
      "employees",
      "employeesTable",
      "employeeDetail",
      "employeeEdit",
      "employeeTypes",
    ];

    function leafKeys(obj, prefix = "") {
      return Object.entries(obj ?? {}).flatMap(([k, v]) => {
        const key = prefix ? `${prefix}.${k}` : k;
        return v && typeof v === "object" && !Array.isArray(v) ? leafKeys(v, key) : [key];
      });
    }

    for (const ns of HR_EMPLOYEES_NAMESPACES) {
      expect(en[ns], `en.json is missing the "${ns}" namespace`).toBeDefined();
      expect(hi[ns], `hi.json is missing the "${ns}" namespace`).toBeDefined();

      const enKeys = leafKeys(en[ns]).sort();
      const hiKeys = leafKeys(hi[ns]).sort();
      expect(hiKeys, `hi.json["${ns}"] keys must match en.json["${ns}"] keys`).toEqual(enKeys);
    }
  });
});
