#!/usr/bin/env node
// ─────────────────────────────────────────────────────────────────────────────
// empty-vs-error-guard.mjs — a fetch failure must never render as "you have
// no data yet" (UX-001).
//
// THE DEFECT THIS CATCHES
// ------------------------
// apps/web/src/app/_data/apiClient.ts's fetchJson() never throws: on any
// failure (missing config, missing auth, non-2xx, bad payload, network error)
// it resolves { data: empty, source: "error" }. Individual page.tsx files
// then decide what to render by checking data.length === 0 (or an equivalent
// "is there anything to show" check) — and, in the large majority measured
// by the 2026-09-07 audit, NEVER also looked at `source`. A real outage and a
// tenant with genuinely zero rows render pixel-identical: zero stat cards, a
// cheerful "create your first…" prompt.
//
// CHECK: for every apps/web/src/app/**/page.tsx, if the file contains an
// empty-check (`.length === 0`, the most common shape; `Object.keys(x).length
// === 0` matches too) then the file must ALSO show evidence that it branches
// on the loader's error token somewhere — any of:
//   source === "error" | status === "error" | errored (identifier)
//   useResource(...) | combineResourceState(...)
//   <ErrorState | <RefreshErrorState
// A file with an empty-check and none of the above is a violation: it cannot
// be telling a real outage apart from a genuinely empty tenant.
//
// This is a file-level heuristic, not full data-flow analysis — it cannot see
// whether the error-aware token is actually wired to the SAME empty-check's
// branch, only that the file shows awareness of the distinction somewhere.
// That is deliberate: it matches how the gap register itself measured the
// backlog (page.tsx file count), it has zero false negatives that matter (a
// file with the empty-check and no error-aware token anywhere is worth a
// look, full stop), and it stays maintainable as a ~150-line grep instead of
// a bespoke TS AST/data-flow rule — the same tradeoff every other scripts/ci
// guard in this repo makes (see money-precision-guard.mjs, arch-guard.mjs).
//
// Suppress a specific line with a `// ux-001-ok: <reason>` comment on the
// same line as the empty-check, for the rare page whose empty-check has
// nothing to do with a remote fetch (e.g. a purely client-derived/local
// computation with no loader in the picture).
//
// RATCHET, NOT A FULL GATE: this fix's first tranche closes the 5 pages named
// in the gap plus a further batch (see docs/ENTERPRISE-GAP-REPORT-2026-09-07
// UX-001 and its follow-up for the remainder). Failing CI on the whole
// backlog immediately would block every unrelated web PR fleet-wide, so —
// exactly like scripts/ci/tenant-index-guard.mjs and schema-drift-guard.mjs —
// known violations are tracked in a baseline file and do not fail the build;
// the gate is on NEW violations (a newly written page with the same bug) and
// on stale baseline entries (a page fixed but left listed, so a real fix
// can't be silently reverted for free without anyone noticing the baseline
// disagrees).
//
// Usage:
//   node scripts/ci/empty-vs-error-guard.mjs                 # guard: exit 1 on
//                                                              # new/stale baseline entries
//   node scripts/ci/empty-vs-error-guard.mjs --report         # print full violation list,
//                                                              # does not affect exit code
//   node scripts/ci/empty-vs-error-guard.mjs --write-baseline # regenerate the baseline from
//                                                              # the current tree
// ─────────────────────────────────────────────────────────────────────────────
import { readdirSync, statSync, readFileSync, writeFileSync, existsSync } from "node:fs";
import { join, relative, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = join(__dirname, "..", "..");
const APP_DIR = join(REPO_ROOT, "apps", "web", "src", "app");
const BASELINE_PATH = join(__dirname, "empty-vs-error-baseline.json");

const RED = "\x1b[31m";
const GREEN = "\x1b[32m";
const YELLOW = "\x1b[33m";
const CYAN = "\x1b[36m";
const RESET = "\x1b[0m";
const BOLD = "\x1b[1m";
const DIM = "\x1b[2m";

const SKIP_DIRS = new Set(["node_modules", ".next", "dist", "build", "figma-designs"]);

function* walkPageFiles(dir) {
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
      yield* walkPageFiles(full);
    } else if (entry.isFile() && entry.name === "page.tsx") {
      yield full;
    }
  }
}

const EMPTY_CHECK_RE = /\.length\s*===\s*0/g;
const ERROR_AWARE_RE =
  /source\s*===\s*"error"|status\s*===\s*"error"|errored|useResource\s*\(|combineResourceState\s*\(|<ErrorState|<RefreshErrorState/i;
const SUPPRESS_RE = /ux-001-ok/;

/**
 * Pure check, exported for fixture-based unit tests (see
 * tests/architecture/empty-vs-error-guard.test.ts) — mirrors the
 * "exported functions + optional CLI entrypoint" shape used by
 * tenant-router-guard.mjs, so this can be exercised with in-memory source
 * strings instead of requiring real fixture files on disk.
 *
 * Returns the list of offending {line, snippet} empty-checks, or null when
 * the source is clean (no empty-check at all, or an empty-check paired with
 * evidence of error-token awareness anywhere in the file).
 */
export function checkSource(source) {
  const lines = source.split("\n");
  const emptyCheckLines = [];

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    EMPTY_CHECK_RE.lastIndex = 0;
    if (EMPTY_CHECK_RE.test(line) && !SUPPRESS_RE.test(line)) {
      emptyCheckLines.push({ line: i + 1, snippet: line.trim().slice(0, 140) });
    }
  }

  if (emptyCheckLines.length === 0) return null;
  if (ERROR_AWARE_RE.test(source)) return null;

  return emptyCheckLines;
}

function analyzeFile(filePath) {
  const source = readFileSync(filePath, "utf8");
  return checkSource(source);
}

function discoverViolations() {
  const violations = new Map(); // relPath -> emptyCheckLines
  let filesScanned = 0;
  if (!existsSync(APP_DIR)) return { violations, filesScanned };

  for (const file of walkPageFiles(APP_DIR)) {
    filesScanned++;
    const emptyCheckLines = analyzeFile(file);
    if (emptyCheckLines) {
      violations.set(relative(REPO_ROOT, file), emptyCheckLines);
    }
  }
  return { violations, filesScanned };
}

function loadBaseline() {
  if (!existsSync(BASELINE_PATH)) return { files: new Set(), raw: null };
  const raw = JSON.parse(readFileSync(BASELINE_PATH, "utf8"));
  return { files: new Set(raw.knownViolations ?? []), raw };
}

function writeBaseline(files) {
  const sorted = [...files].sort();
  const content = {
    $comment:
      "TRACKED DEBT, not an approved state. Each entry is a page.tsx with a " +
      ".length === 0 (or equivalent) empty-check and no evidence anywhere in " +
      "the file that it also branches on the loader's error token — see " +
      "scripts/ci/empty-vs-error-guard.mjs for the exact check. The gate " +
      "fails on NEW violations and on stale entries (fixed but left listed). " +
      "Burn these down; regenerate with --write-baseline after a real fix. " +
      "See docs/ENTERPRISE-GAP-REPORT-2026-09-07.md UX-001 (first tranche) " +
      "and its follow-up (UX-012) for the remainder.",
    generatedAt: new Date().toISOString().slice(0, 10),
    knownViolations: sorted,
  };
  writeFileSync(BASELINE_PATH, JSON.stringify(content, null, 2) + "\n");
  return sorted;
}

function main() {
  const args = process.argv.slice(2);
  const writeMode = args.includes("--write-baseline");
  const reportMode = args.includes("--report");

  const { violations, filesScanned } = discoverViolations();
  const currentFiles = new Set(violations.keys());

  console.log("──────────────────────────────────────────────────────────────");
  console.log("  Empty-vs-Error Guard — fetch failure vs genuinely-empty (UX-001)");
  console.log("──────────────────────────────────────────────────────────────");
  console.log(`  page.tsx files scanned: ${filesScanned}`);
  console.log(`  Currently violating:    ${currentFiles.size}`);
  console.log("");

  if (writeMode) {
    const sorted = writeBaseline(currentFiles);
    console.log(`  ${GREEN}Wrote baseline with ${sorted.length} known violation(s) to${RESET}`);
    console.log(`  ${DIM}${relative(REPO_ROOT, BASELINE_PATH)}${RESET}`);
    console.log("──────────────────────────────────────────────────────────────");
    process.exit(0);
  }

  if (reportMode) {
    for (const [file, lines] of [...violations.entries()].sort()) {
      console.log(`  ${YELLOW}[VIOLATION]${RESET} ${file}`);
      for (const l of lines) {
        console.log(`      ${DIM}${l.line}: ${l.snippet}${RESET}`);
      }
    }
    console.log("──────────────────────────────────────────────────────────────");
    process.exit(0);
  }

  const { files: baselineFiles } = loadBaseline();
  const newViolations = [...currentFiles].filter((f) => !baselineFiles.has(f)).sort();
  const staleEntries = [...baselineFiles].filter((f) => !currentFiles.has(f)).sort();

  if (newViolations.length === 0 && staleEntries.length === 0) {
    console.log(`  ${GREEN}✅ PASS — matches baseline (${baselineFiles.size} tracked, 0 new).${RESET}`);
    console.log("──────────────────────────────────────────────────────────────");
    process.exit(0);
  }

  if (newViolations.length > 0) {
    console.log(`  ${RED}${BOLD}❌ ${newViolations.length} NEW violation(s) not in the baseline:${RESET}`);
    for (const f of newViolations) {
      const lines = violations.get(f);
      console.log(`  ${RED}[NEW]${RESET} ${f}`);
      for (const l of lines) {
        console.log(`      ${DIM}${l.line}: ${l.snippet}${RESET}`);
      }
    }
    console.log("");
  }

  if (staleEntries.length > 0) {
    console.log(`  ${RED}${BOLD}❌ ${staleEntries.length} stale baseline entr(y/ies) — fixed but left listed:${RESET}`);
    for (const f of staleEntries) {
      console.log(`  ${RED}[STALE]${RESET} ${f}`);
    }
    console.log(`  ${CYAN}Regenerate with: node scripts/ci/empty-vs-error-guard.mjs --write-baseline${RESET}`);
    console.log("");
  }

  console.log(
    `  ${RED}Fix: branch on the loader's source/status (useResource/combineResourceState,${RESET}`,
  );
  console.log(
    `  ${RED}<ErrorState>/<RefreshErrorState>) before deciding "empty", or suppress a${RESET}`,
  );
  console.log(`  ${RED}genuinely unrelated line with // ux-001-ok: <reason>.${RESET}`);
  console.log("──────────────────────────────────────────────────────────────");
  process.exit(1);
}

// Only run the CLI when invoked directly (`node scripts/ci/empty-vs-error-guard.mjs`),
// not when imported by tests/architecture/empty-vs-error-guard.test.ts for checkSource().
if (import.meta.url === `file://${process.argv[1]}`) {
  main();
}
