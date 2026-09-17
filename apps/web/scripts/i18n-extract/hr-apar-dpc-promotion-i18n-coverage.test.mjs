// UX-017 (tranche 8): regression guard for the hr/apar + hr/dpc +
// hr/promotion sub-modules' i18n slice ("APAR -> DPC -> Promotion", the
// career-progression pipeline -- dpc/_components/PromotionBatchView.tsx and
// dpc/page.tsx both import promotion/_components/PromotionCard's exported
// PromotionRow type/component directly, a real, pre-existing code coupling
// between dpc/ and promotion/, not an arbitrarily bundled grouping). Mirrors
// hr-employees-i18n-coverage.test.mjs (tranche 7), hr-workforce-i18n-coverage.test.mjs
// (tranche 6), finance-pfms-i18n-coverage.test.mjs (tranche 5), and
// hr-leave-i18n-coverage.test.mjs (tranche 2). Two things are checked,
// independent of each other:
//
//  1. The UX-004 scanner's hardcoded-string count for src/app/(app)/hr/apar,
//     src/app/(app)/hr/dpc and src/app/(app)/hr/promotion does not regress
//     above the count left after this tranche (1 + 5 + 4 = 10 findings, all
//     confirmed -- by manual review of every single one, see the tranche-8
//     commit message -- to be scanner false positives, not real UI text: a
//     `.status === "closed"`-style string comparison or a `useState<T>()`/
//     `Record<string, string>` TypeScript generic bracket sitting near a
//     real JSX closing tag or a nearby comment reads, to the regex, exactly
//     like real tracked patterns. If this test starts failing because the
//     count went *up*, that's the signal to check for a real regression
//     with `--list`.
//
//  2. Every message key referenced by the apar/dpc/promotion namespaces
//     exists in *both* en.json and hi.json (no locale silently falls back
//     to a missing key at runtime).
import { describe, it, expect } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { scanSource } from "./scanner.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const webRoot = path.resolve(__dirname, "..", "..");
const hrAparDir = path.resolve(webRoot, "src/app/(app)/hr/apar");
const hrDpcDir = path.resolve(webRoot, "src/app/(app)/hr/dpc");
const hrPromotionDir = path.resolve(webRoot, "src/app/(app)/hr/promotion");

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

const HR_APAR_DPC_PROMOTION_HARDCODED_STRING_CEILING = 10; // 1 (apar/) + 5 (dpc/) + 4 (promotion/)

describe("hr/apar + hr/dpc + hr/promotion i18n coverage (UX-017 tranche 8)", () => {
  it("does not exceed the known false-positive baseline for hardcoded strings", () => {
    const files = [...walk(hrAparDir), ...walk(hrDpcDir), ...walk(hrPromotionDir)];
    const findings = files.flatMap((file) => scanSource(path.relative(webRoot, file), fs.readFileSync(file, "utf8")));

    if (findings.length > HR_APAR_DPC_PROMOTION_HARDCODED_STRING_CEILING) {
      const extra = findings.slice(HR_APAR_DPC_PROMOTION_HARDCODED_STRING_CEILING).map((f) => `${f.file}:${f.line} ${JSON.stringify(f.text)}`);
      throw new Error(
        `hr/apar + hr/dpc + hr/promotion hardcoded-string count grew from ${HR_APAR_DPC_PROMOTION_HARDCODED_STRING_CEILING} to ${findings.length}. ` +
          `Run \`node scripts/i18n-extract/cli.mjs --dir "src/app/(app)/hr/apar" --list\` (and the same for dpc/promotion) and translate any ` +
          `genuine new hardcoded string (most residual findings are scanner false positives on TS generics/status-comparison code fragments -- see this file's header). ` +
          `New/changed findings include:\n${extra.join("\n")}`,
      );
    }
    expect(findings.length).toBeLessThanOrEqual(HR_APAR_DPC_PROMOTION_HARDCODED_STRING_CEILING);
  });

  it("has no en.json/hi.json key drift for the hr/apar + hr/dpc + hr/promotion namespaces", () => {
    const en = JSON.parse(fs.readFileSync(path.join(webRoot, "src/messages/en.json"), "utf8"));
    const hi = JSON.parse(fs.readFileSync(path.join(webRoot, "src/messages/hi.json"), "utf8"));

    const HR_APAR_DPC_PROMOTION_NAMESPACES = [
      "apar",
      "aparDetail",
      "aparNew",
      "aparFlowCard",
      "dpc",
      "dpcBatchView",
      "dpcSeniorityActions",
      "promotion",
      "promotionApprove",
      "promotionCard",
    ];

    function leafKeys(obj, prefix = "") {
      return Object.entries(obj ?? {}).flatMap(([k, v]) => {
        const key = prefix ? `${prefix}.${k}` : k;
        return v && typeof v === "object" && !Array.isArray(v) ? leafKeys(v, key) : [key];
      });
    }

    for (const ns of HR_APAR_DPC_PROMOTION_NAMESPACES) {
      expect(en[ns], `en.json is missing the "${ns}" namespace`).toBeDefined();
      expect(hi[ns], `hi.json is missing the "${ns}" namespace`).toBeDefined();

      const enKeys = leafKeys(en[ns]).sort();
      const hiKeys = leafKeys(hi[ns]).sort();
      expect(hiKeys, `hi.json["${ns}"] keys must match en.json["${ns}"] keys`).toEqual(enKeys);
    }
  });
});
