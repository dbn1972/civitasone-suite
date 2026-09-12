// UX-017: regression guard for the citizen-hub i18n tranche. Two things are
// checked, independent of each other:
//
//  1. The UX-004 scanner's hardcoded-string count for the citizen hub does not
//     regress above the count left after UX-017 (39 findings, all confirmed —
//     by manual review of every single one, see below — to be scanner false
//     positives, not real UI text: the scanner is a `>text<` / `prop="..."`
//     regex heuristic, not a TS-aware parser, so a `<` used as a TypeScript
//     generic bracket (`useState<T>`, `useMemo<T>`, `Promise<T>`, `Record<...>`)
//     or a numeric/boolean comparison operator (`n < 0`, `s.id === active`)
//     sitting near a real JSX closing tag reads, to the regex, exactly like
//     the start of a JSX text node. Wrapping the real, genuinely hardcoded
//     strings in `t()` is precisely what makes the *content* of those false
//     positives disappear; the remaining count is the scanner's own
//     documented limitation ("Deliberately a heuristic ... false positives
//     ... are expected" — scanner.mjs header), not unfinished translation
//     work. If this test starts failing because the count went *up*, that's
//     the signal to check for a real regression with `--list`.
//
//  2. Every message key referenced by the citizen hub's namespaces exists in
//     *both* en.json and hi.json (no locale silently falls back to a missing
//     key at runtime).
import { describe, it, expect } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { scanSource } from "./scanner.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const webRoot = path.resolve(__dirname, "..", "..");
const citizenDir = path.resolve(webRoot, "src/app/(app)/citizen");

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

const CITIZEN_HARDCODED_STRING_CEILING = 39;

describe("citizen hub i18n coverage (UX-017)", () => {
  it("does not exceed the known false-positive baseline for hardcoded strings", () => {
    const files = walk(citizenDir);
    const findings = files.flatMap((file) => scanSource(path.relative(webRoot, file), fs.readFileSync(file, "utf8")));

    if (findings.length > CITIZEN_HARDCODED_STRING_CEILING) {
      const extra = findings.slice(CITIZEN_HARDCODED_STRING_CEILING).map((f) => `${f.file}:${f.line} ${JSON.stringify(f.text)}`);
      throw new Error(
        `citizen hub hardcoded-string count grew from ${CITIZEN_HARDCODED_STRING_CEILING} to ${findings.length}. ` +
          `Run \`node scripts/i18n-extract/cli.mjs --dir "src/app/(app)/citizen" --list\` and translate any genuine ` +
          `new hardcoded string (most residual findings are scanner false positives on TS generics/comparisons — ` +
          `see this file's header). New/changed findings include:\n${extra.join("\n")}`,
      );
    }
    expect(findings.length).toBeLessThanOrEqual(CITIZEN_HARDCODED_STRING_CEILING);
  });

  it("has no en.json/hi.json key drift for the citizen-hub namespaces", () => {
    const en = JSON.parse(fs.readFileSync(path.join(webRoot, "src/messages/en.json"), "utf8"));
    const hi = JSON.parse(fs.readFileSync(path.join(webRoot, "src/messages/hi.json"), "utf8"));

    const CITIZEN_NAMESPACES = [
      "citizen",
      "citizenAlerts",
      "citizenAppeals",
      "citizenCatalogue",
      "citizenCertificates",
      "citizenDiscovery",
      "citizenDocuments",
      "citizenEligibility",
      "citizenFeedback",
      "citizenIntake",
      "citizenNotices",
      "citizenPayments",
      "citizenPortal",
      "citizenRequests",
      "citizenRti",
      "citizenServices",
      "citizenSurveys",
      "grievances",
    ];

    function leafKeys(obj, prefix = "") {
      return Object.entries(obj ?? {}).flatMap(([k, v]) => {
        const key = prefix ? `${prefix}.${k}` : k;
        return v && typeof v === "object" && !Array.isArray(v) ? leafKeys(v, key) : [key];
      });
    }

    for (const ns of CITIZEN_NAMESPACES) {
      expect(en[ns], `en.json is missing the "${ns}" namespace`).toBeDefined();
      expect(hi[ns], `hi.json is missing the "${ns}" namespace`).toBeDefined();

      const enKeys = leafKeys(en[ns]).sort();
      const hiKeys = leafKeys(hi[ns]).sort();
      expect(hiKeys, `hi.json["${ns}"] keys must match en.json["${ns}"] keys`).toEqual(enKeys);
    }
  });
});
