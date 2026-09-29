#!/usr/bin/env node
// ─────────────────────────────────────────────────────────────────────────────
// datatable-render-guard.mjs — Server Component / DataTable `render:` guard
// (SF-08)
//
// DataTable (apps/web/src/app/_components/ds/DataTable.tsx) is a "use client"
// component. Its `Column.render` prop is a function -- functions can't cross
// the Server -> Client (RSC) boundary. A Server Component (no "use client")
// that builds a `render: (row) => ...` closure and passes it into DataTable's
// columns prop crashes on every load: React throws while serializing that
// Server Component's props, before DataTable's own code ever runs. This is
// GAP-HR-EXPENSES-01 (fixed in PR #1647) — a real instance of exactly this
// bug reaching the hr/expenses page.
//
// Nothing in TypeScript catches this: a function is a perfectly valid JS
// value regardless of which side of the RSC boundary constructed it, so
// there is no type that distinguishes "a render closure built in a Server
// Component" from "one built in a Client Component". A DataTable-internal
// runtime guard can't catch it either — by the time DataTable's own code
// would run, the crash has already happened upstream (see DataTable.tsx's
// Column<T> doc comment). Static source-text scanning, before the code ever
// ships, is the only thing that actually prevents this crash class, so
// that's what this guard does.
//
// It flags a `.tsx` file under apps/web/src/app/** when it:
//   - imports DataTable, AND
//   - contains a `render:` column definition, AND
//   - does not open with a "use client" directive.
//
// Ratchet (same convention as stat-tile-literal-guard.mjs / nested-tx-guard.mjs
// / raw-status-leak-guard.mjs etc.): fails on a NEW violation not already in
// scripts/ci/datatable-render-guard-baseline.json, and on a STALE baseline
// entry (fixed, or never real, but still listed) — so known pre-existing debt
// doesn't block CI, but nothing new (or newly un-fixed) can sneak in quietly.
// The baseline ships with exactly one entry (hr/locations/page.tsx): three
// columns whose `render:` builds actual styled JSX (an icon, two colour-coded
// badge spans) that no existing cellType reproduces and that DataTable's
// plain-string fallback can't display either -- fixing it needs either a
// DataTable capability change or a page rewrite, both a real design
// decision, not a mechanical cellType swap (see SF-08's own PR description).
// Every OTHER known instance of this pattern is fixed in the same change
// that adds this guard, so the baseline starts, and should stay, at exactly
// that one entry.
//
// Best-effort, regex/text based (same tradeoff as arch-guard.mjs): comments
// are stripped before matching. This will not catch `render` reaching
// DataTable via a spread/indirection (e.g. built in a helper function in a
// different file and imported in), and it does not attempt real Server/
// Client boundary analysis across module boundaries. It is meant to catch
// the common, direct case cheaply, not to be a complete RSC type-checker.
//
// Usage:  node scripts/ci/datatable-render-guard.mjs                (check)
//         node scripts/ci/datatable-render-guard.mjs --write-baseline
//                                                     (regenerate baseline
//                                                      after a real fix)
// Exit:   0 when clean (no new/stale entries), 1 otherwise.
// ─────────────────────────────────────────────────────────────────────────────

import { readdirSync, readFileSync, writeFileSync, existsSync } from "node:fs";
import { join, relative, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
// scripts/ci/datatable-render-guard.mjs  ->  repo root is two levels up.
const REPO_ROOT = join(__dirname, "..", "..");
const APP_DIR = join(REPO_ROOT, "apps", "web", "src", "app");
const BASELINE_PATH = join(__dirname, "datatable-render-guard-baseline.json");

const SKIP_DIRS = new Set(["node_modules", "dist", "build", ".next", ".turbo", "coverage"]);

function isSkippedFile(name) {
  return (
    name.endsWith(".test.tsx") ||
    name.endsWith(".spec.tsx") ||
    name.endsWith(".d.ts")
  );
}

function* walkTsxFiles(dir) {
  let entries;
  try {
    entries = readdirSync(dir, { withFileTypes: true });
  } catch {
    return;
  }
  for (const entry of entries) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) {
      if (SKIP_DIRS.has(entry.name)) continue;
      yield* walkTsxFiles(full);
    } else if (entry.isFile() && entry.name.endsWith(".tsx") && !isSkippedFile(entry.name)) {
      yield full;
    }
  }
}

// Strips // and /* */ comments, best-effort (mirrors arch-guard.mjs), while
// preserving line count so reported line numbers stay accurate.
function stripComments(source) {
  const out = [];
  let inBlock = false;
  for (const rawLine of source.split("\n")) {
    let line = rawLine;
    if (inBlock) {
      const end = line.indexOf("*/");
      if (end === -1) {
        out.push("");
        continue;
      }
      line = " ".repeat(end + 2) + line.slice(end + 2);
      inBlock = false;
    }
    let result = "";
    let i = 0;
    while (i < line.length) {
      const two = line.slice(i, i + 2);
      if (two === "/*") {
        const end = line.indexOf("*/", i + 2);
        if (end === -1) {
          inBlock = true;
          break;
        }
        result += " ".repeat(end + 2 - i);
        i = end + 2;
      } else if (two === "//") {
        break;
      } else {
        result += line[i];
        i += 1;
      }
    }
    out.push(result);
  }
  return out;
}

// The "use client" directive only takes effect as the first statement of the
// module (blank lines before it are fine; anything else before it is not).
function hasLeadingUseClientDirective(strippedLines) {
  for (const line of strippedLines) {
    const trimmed = line.trim();
    if (trimmed === "") continue;
    return /^["']use client["'];?$/.test(trimmed);
  }
  return false;
}

/**
 * Pure check, exported for direct unit testing (mirrors
 * stat-tile-literal-guard.mjs's checkStatTileLiteralViolations() shape):
 * given a `.tsx` file's full source text, returns the 1-based line number of
 * its first `render:` column definition if this file is a violation (imports
 * DataTable, contains `render:`, has no leading "use client" directive), or
 * `null` if it isn't.
 */
export function checkSourceForRenderGuardViolation(source) {
  const strippedLines = stripComments(source);
  const stripped = strippedLines.join("\n");

  if (!/\bDataTable\b/.test(stripped)) return null;
  if (!/\brender\s*:/.test(stripped)) return null;
  if (hasLeadingUseClientDirective(strippedLines)) return null;

  return strippedLines.findIndex((l) => /\brender\s*:/.test(l)) + 1;
}

function checkFile(filePath) {
  const source = readFileSync(filePath, "utf8");
  const lineNo = checkSourceForRenderGuardViolation(source);
  if (lineNo === null) return null;

  const relPath = relative(REPO_ROOT, filePath);
  return { key: `${relPath}:${lineNo}`, relPath, lineNo };
}

function findAllViolations() {
  const violations = [];
  for (const file of walkTsxFiles(APP_DIR)) {
    const v = checkFile(file);
    if (v) violations.push(v);
  }
  return violations;
}

function readBaseline() {
  if (!existsSync(BASELINE_PATH)) return new Set();
  let raw;
  try {
    raw = JSON.parse(readFileSync(BASELINE_PATH, "utf8"));
  } catch (e) {
    console.error(`FAILED: ${relative(REPO_ROOT, BASELINE_PATH)} is not valid JSON — ${e.message}`);
    process.exit(1);
  }
  if (!Array.isArray(raw.entries)) {
    console.error(
      `FAILED: ${relative(REPO_ROOT, BASELINE_PATH)} is malformed — \`entries\` must be an array.\n` +
        `  Regenerate it with: node scripts/ci/datatable-render-guard.mjs --write-baseline`,
    );
    process.exit(1);
  }
  return new Set(raw.entries);
}

function writeBaseline(violations) {
  const entries = violations.map((v) => v.key).sort();
  const baseline = {
    _comment:
      "TRACKED DEBT, not an approved state. Each entry is a <file>:<line> where a Server " +
      "Component passes `render:` into DataTable's columns (the GAP-HR-EXPENSES-01 / PR #1647 " +
      "crash class). The gate fails on NEW entries and on stale entries (fixed, or never real, " +
      "but still listed). Burn these down; regenerate with --write-baseline after a real fix, " +
      "same convention as stat-tile-literal-baseline.json / nested-tx-baseline.json.",
    generatedAt: new Date().toISOString().slice(0, 10),
    count: entries.length,
    entries,
  };
  writeFileSync(BASELINE_PATH, JSON.stringify(baseline, null, 2) + "\n");
  console.log(`Wrote ${entries.length} entries to ${relative(REPO_ROOT, BASELINE_PATH)}`);
}

function main() {
  if (!existsSync(APP_DIR)) {
    console.error(`datatable-render-guard: app directory not found at ${APP_DIR}`);
    process.exit(1);
  }

  const writeMode = process.argv.includes("--write-baseline");
  const violations = findAllViolations();

  if (writeMode) {
    writeBaseline(violations);
    return;
  }

  const baselineKeys = readBaseline();
  const currentKeys = new Set(violations.map((v) => v.key));
  const novel = violations.filter((v) => !baselineKeys.has(v.key));
  const stale = [...baselineKeys].filter((k) => !currentKeys.has(k)).sort();

  let fail = false;

  if (novel.length > 0) {
    fail = true;
    console.error(
      "datatable-render-guard: NEW render: prop(s) passed to DataTable from a file without a " +
        "leading \"use client\":\n",
    );
    for (const v of novel) console.error(`  ${v.key}  <-- NEW, not in baseline`);
    console.error(
      "\nDataTable is a Client Component; a `render` function can't cross the Server->Client\n" +
        "boundary and will crash the page (see GAP-HR-EXPENSES-01 / PR #1647). Use a built-in\n" +
        "cellType (\"status\" | \"amount\" | \"rupees\" | \"date\") instead, or add \"use client\" as\n" +
        "this file's first statement (and pass in only serializable data, not the render\n" +
        "function itself) if it genuinely needs to be a Client Component.\n",
    );
  }

  if (stale.length > 0) {
    fail = true;
    console.error(
      `datatable-render-guard: ${stale.length} baselined entr${stale.length === 1 ? "y" : "ies"} ` +
        "no longer match the real tree (fixed, or never real — remove from baseline):\n",
    );
    for (const k of stale) console.error(`  ${k}`);
    console.error(
      "\nRegenerate: node scripts/ci/datatable-render-guard.mjs --write-baseline",
    );
  }

  if (fail) process.exit(1);

  console.log(
    `datatable-render-guard: clean (${violations.length} known-debt entr${violations.length === 1 ? "y" : "ies"} in baseline, 0 new).`,
  );
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main();
}
