// UX-017 (tranche 5): regression guard for the finance/pfms feature's i18n
// slice. Mirrors citizen-i18n-coverage.test.mjs (tranche 1) and
// hr-leave-i18n-coverage.test.mjs (tranche 2). Two things are checked,
// independent of each other:
//
//  1. The UX-004 scanner's hardcoded-string count for src/app/(app)/finance/pfms
//     does not regress above the count left after this tranche (30 findings,
//     all confirmed -- by manual review of every single one, see the tranche-5
//     commit message -- to be scanner false positives, not real UI text: the
//     scanner is a `>text<` / `prop="..."` regex heuristic, not a TS-aware
//     parser, so a `<` used as a TypeScript generic bracket (`useState<T>`,
//     `useRef<T>`, `Record<...>`), or an arithmetic/reduce expression
//     (`sum + BigInt(...), 0n)`) sitting near a real JSX closing tag or a
//     `return (` all read, to the regex, exactly like the start of a JSX
//     text node. If this test starts failing because the count went *up*,
//     that's the signal to check for a real regression with `--list`.
//
//  2. Every message key referenced by the finance/pfms namespaces exists in
//     *both* en.json and hi.json (no locale silently falls back to a missing
//     key at runtime).
import { describe, it, expect } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { scanSource } from "./scanner.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const webRoot = path.resolve(__dirname, "..", "..");
const financePfmsDir = path.resolve(webRoot, "src/app/(app)/finance/pfms");

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

const FINANCE_PFMS_HARDCODED_STRING_CEILING = 30;

describe("finance/pfms i18n coverage (UX-017 tranche 5)", () => {
  it("does not exceed the known false-positive baseline for hardcoded strings", () => {
    const files = walk(financePfmsDir);
    const findings = files.flatMap((file) => scanSource(path.relative(webRoot, file), fs.readFileSync(file, "utf8")));

    if (findings.length > FINANCE_PFMS_HARDCODED_STRING_CEILING) {
      const extra = findings.slice(FINANCE_PFMS_HARDCODED_STRING_CEILING).map((f) => `${f.file}:${f.line} ${JSON.stringify(f.text)}`);
      throw new Error(
        `finance/pfms hardcoded-string count grew from ${FINANCE_PFMS_HARDCODED_STRING_CEILING} to ${findings.length}. ` +
          `Run \`node scripts/i18n-extract/cli.mjs --dir "src/app/(app)/finance/pfms" --list\` and translate any genuine ` +
          `new hardcoded string (most residual findings are scanner false positives on TS generics/comparisons/ternaries -- ` +
          `see this file's header). New/changed findings include:\n${extra.join("\n")}`,
      );
    }
    expect(findings.length).toBeLessThanOrEqual(FINANCE_PFMS_HARDCODED_STRING_CEILING);
  });

  it("has no en.json/hi.json key drift for the finance/pfms namespaces", () => {
    const en = JSON.parse(fs.readFileSync(path.join(webRoot, "src/messages/en.json"), "utf8"));
    const hi = JSON.parse(fs.readFileSync(path.join(webRoot, "src/messages/hi.json"), "utf8"));

    const FINANCE_PFMS_NAMESPACES = [
      "pfms",
      "pfmsConsole",
      "pfmsBatchesPanel",
      "pfmsConfigPanel",
      "pfmsPaymentsPanel",
      "pfmsSignBatchAction",
      "pfmsBankFileAction",
      "pfmsPaymentStatusLookup",
      "pfmsPaymentAdviceForm",
      "pfmsAdviceStatusLookup",
      "pfmsSalaryBillForm",
      "pfmsSubmitPaymentForm",
    ];

    function leafKeys(obj, prefix = "") {
      return Object.entries(obj ?? {}).flatMap(([k, v]) => {
        const key = prefix ? `${prefix}.${k}` : k;
        return v && typeof v === "object" && !Array.isArray(v) ? leafKeys(v, key) : [key];
      });
    }

    for (const ns of FINANCE_PFMS_NAMESPACES) {
      expect(en[ns], `en.json is missing the "${ns}" namespace`).toBeDefined();
      expect(hi[ns], `hi.json is missing the "${ns}" namespace`).toBeDefined();

      const enKeys = leafKeys(en[ns]).sort();
      const hiKeys = leafKeys(hi[ns]).sort();
      expect(hiKeys, `hi.json["${ns}"] keys must match en.json["${ns}"] keys`).toEqual(enKeys);
    }
  });
});
