#!/usr/bin/env node
// ─────────────────────────────────────────────────────────────────────────────
// jsx-a11y-ratchet-guard.mjs — UX-005 tranche 1.
//
// THE GAP THIS CLOSES
// --------------------
// apps/web/eslint.config.js had no jsx-a11y plugin at all (never wired in),
// so a whole category of real WCAG 2.2 AA defects -- missing form labels,
// no-keyboard-equivalent click handlers, redundant/invalid ARIA roles,
// autofocus -- had no static gate whatsoever. The axe-core Playwright gate
// (apps/web/tests/a11y/a11y.spec.ts) only ever sees whatever routes are
// rendered in its manifest; this catches the same rule family at the source
// level, on every file, every PR.
//
// WHY A RATCHET, NOT A HARD CUTOVER
// -----------------------------------
// eslint.config.js registers jsx-a11y's recommended rules at "warn" (see the
// comment there) specifically so turning the plugin on does not fail
// `pnpm turbo lint` outright on this repo's pre-existing violations. This
// script is the actual gate: it runs eslint itself, counts ONLY jsx-a11y/*
// warnings, and fails on any (file|rule) pair not already in the baseline --
// exactly the pattern already established by scripts/ci/empty-vs-error-guard.mjs,
// raw-status-leak-guard.mjs, tenant-index-guard.mjs, etc. A stale baseline
// entry (fixed but left listed) also fails, the same way, so a real fix must
// be accompanied by a re-baseline in the same PR -- the backlog can only
// shrink from here.
//
// Usage:
//   node scripts/ci/jsx-a11y-ratchet-guard.mjs                 # guard: exit 1 on
//                                                                # new/stale baseline entries
//   node scripts/ci/jsx-a11y-ratchet-guard.mjs --report         # print full violation list,
//                                                                # does not affect exit code
//   node scripts/ci/jsx-a11y-ratchet-guard.mjs --write-baseline # regenerate the baseline from
//                                                                # the current tree
// ─────────────────────────────────────────────────────────────────────────────
import { execFileSync } from "node:child_process";
import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { join, dirname, relative } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = join(__dirname, "..", "..");
const WEB_DIR = join(REPO_ROOT, "apps", "web");
const BASELINE_PATH = join(__dirname, "jsx-a11y-baseline.json");

const RED = "\x1b[31m";
const GREEN = "\x1b[32m";
const YELLOW = "\x1b[33m";
const CYAN = "\x1b[36m";
const RESET = "\x1b[0m";
const BOLD = "\x1b[1m";
const DIM = "\x1b[2m";

/** Stable key for the ratchet: a specific jsx-a11y rule violated on a
 * specific line of a specific file. Line is included (unlike the route|rule
 * keys elsewhere) because, unlike a route-level axe audit, several distinct
 * violations of the SAME rule commonly occur in the SAME file (e.g. two
 * unrelated unlabelled inputs) and collapsing them to file|rule would let a
 * new violation hide behind an existing one. */
function keyOf(relPath, msg) {
  return `${relPath}:${msg.line}|${msg.ruleId}`;
}

function runEslintJson() {
  const raw = execFileSync(
    "pnpm",
    ["--filter", "@civitasone/web", "exec", "eslint", "src/**/*.{ts,tsx}", "--format", "json"],
    { cwd: REPO_ROOT, encoding: "utf8", maxBuffer: 64 * 1024 * 1024 },
  );
  return JSON.parse(raw);
}

function discoverViolations() {
  const results = runEslintJson();
  const violations = new Map(); // key -> { relPath, line, ruleId, message }
  let filesScanned = 0;
  for (const file of results) {
    filesScanned++;
    const relPath = relative(REPO_ROOT, file.filePath);
    for (const msg of file.messages) {
      if (!msg.ruleId || !msg.ruleId.startsWith("jsx-a11y/")) continue;
      const key = keyOf(relPath, msg);
      violations.set(key, { relPath, line: msg.line, ruleId: msg.ruleId, message: msg.message });
    }
  }
  return { violations, filesScanned };
}

function loadBaseline() {
  if (!existsSync(BASELINE_PATH)) return { keys: new Set(), raw: null };
  const raw = JSON.parse(readFileSync(BASELINE_PATH, "utf8"));
  return { keys: new Set(raw.knownViolations ?? []), raw };
}

function writeBaseline(violations) {
  const sorted = [...violations.keys()].sort();
  const content = {
    $comment:
      "TRACKED DEBT, not an approved state. Each entry is <path>:<line>|<jsx-a11y rule> " +
      "that eslint-plugin-jsx-a11y (registered at \"warn\" in apps/web/eslint.config.js, " +
      "see the comment there for why) currently flags. The gate " +
      "(scripts/ci/jsx-a11y-ratchet-guard.mjs) fails on any NEW entry not already here, " +
      "and on any STALE entry (fixed but left listed) -- burn these down and regenerate " +
      "with --write-baseline in the SAME PR as the fix, the same convention as " +
      "empty-vs-error-baseline.json / raw-status-leak-baseline.json. " +
      "See docs/ENTERPRISE-GAP-REPORT-2026-09-07.md UX-005 (tranche 1).",
    generatedAt: new Date().toISOString().slice(0, 10),
    counts: { total: sorted.length },
    knownViolations: sorted,
  };
  writeFileSync(BASELINE_PATH, JSON.stringify(content, null, 2) + "\n");
  return sorted;
}

function main() {
  const args = process.argv.slice(2);
  const writeMode = args.includes("--write-baseline");
  const reportMode = args.includes("--report");

  console.log("──────────────────────────────────────────────────────────────");
  console.log("  jsx-a11y Ratchet Guard (UX-005)");
  console.log("──────────────────────────────────────────────────────────────");

  const { violations, filesScanned } = discoverViolations();
  console.log(`  Files linted:        ${filesScanned}`);
  console.log(`  Current violations:  ${violations.size}`);
  console.log("");

  if (writeMode) {
    const sorted = writeBaseline(violations);
    console.log(`  ${GREEN}Wrote baseline with ${sorted.length} known violation(s) to${RESET}`);
    console.log(`  ${DIM}${relative(REPO_ROOT, BASELINE_PATH)}${RESET}`);
    console.log("──────────────────────────────────────────────────────────────");
    process.exit(0);
  }

  if (reportMode) {
    for (const [key, v] of [...violations.entries()].sort()) {
      console.log(`  ${YELLOW}[VIOLATION]${RESET} ${key}`);
      console.log(`      ${DIM}${v.message}${RESET}`);
    }
    console.log("──────────────────────────────────────────────────────────────");
    process.exit(0);
  }

  const { keys: baselineKeys } = loadBaseline();
  const currentKeys = new Set(violations.keys());
  const newViolations = [...currentKeys].filter((k) => !baselineKeys.has(k)).sort();
  const staleEntries = [...baselineKeys].filter((k) => !currentKeys.has(k)).sort();

  if (newViolations.length === 0 && staleEntries.length === 0) {
    console.log(`  ${GREEN}PASS — matches baseline (${baselineKeys.size} tracked, 0 new).${RESET}`);
    console.log("──────────────────────────────────────────────────────────────");
    process.exit(0);
  }

  if (newViolations.length > 0) {
    console.log(`  ${RED}${BOLD}${newViolations.length} NEW jsx-a11y violation(s) not in the baseline:${RESET}`);
    for (const k of newViolations) {
      const v = violations.get(k);
      console.log(`  ${RED}[NEW]${RESET} ${k}`);
      if (v) console.log(`      ${DIM}${v.message}${RESET}`);
    }
    console.log("");
  }

  if (staleEntries.length > 0) {
    console.log(`  ${RED}${BOLD}${staleEntries.length} stale baseline entr(y/ies) — fixed but left listed:${RESET}`);
    for (const k of staleEntries) {
      console.log(`  ${RED}[STALE]${RESET} ${k}`);
    }
    console.log(`  ${CYAN}Regenerate with: node scripts/ci/jsx-a11y-ratchet-guard.mjs --write-baseline${RESET}`);
    console.log("");
  }

  console.log(`  ${RED}Fix the violation (real label/keyboard-handler/ARIA fix, not a suppression),${RESET}`);
  console.log(`  ${RED}then regenerate the baseline in the same commit.${RESET}`);
  console.log("──────────────────────────────────────────────────────────────");
  process.exit(1);
}

main();
