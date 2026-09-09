#!/usr/bin/env node
// ─────────────────────────────────────────────────────────────────────────────
// raw-status-leak-guard.mjs — UX-003: no raw HTTP status / raw server text in
// user-facing copy.
//
// Scans apps/web/src/**/*.{ts,tsx} for the two shapes of leak the gap report
// (docs/ENTERPRISE-GAP-REPORT-2026-09-07.md, UX-003) calls out:
//
//   1. A message string that embeds a raw status code in parens, e.g.
//      `Request failed (${res.status})`, `Create failed (${response.status})`.
//   2. The literal phrase "Request failed" (case-insensitive), which was the
//      dominant copy-pasted leak found across ~91 files at the time this
//      guard was written — even when no status code is interpolated, it is
//      still developer-facing phrasing, not clerk-safe copy.
//
// Fix: run the failed response through the shared `useFormError` hook
// (apps/web/src/lib/useFormError.ts) instead — it maps a backend
// `fieldErrors` array to inline field messages and a `code` to a
// `toHumanError` summary line, and never echoes the status or raw body.
//
// Suppress a line deliberately (e.g. a code comment, a log line that never
// reaches the UI) with `// status-leak-ok`.
//
// BASELINE / RATCHET (raw-status-leak-baseline.json):
// UX-003 fixed 4 sampled forms plus the shared hook in one PR; the other
// ~137 files (169 violations at the time this guard was written) are
// tracked as follow-up gap UX-013, not silenced. This guard therefore reads
// a checked-in `maxViolations` from raw-status-leak-baseline.json (sitting
// alongside this script) and only FAILS if the live count exceeds it — i.e.
// it blocks any NEW leak from landing, without pretending the backlog is
// clear. Every UX-013 fix must lower that number in the same PR (see
// tests/architecture/raw-status-leak-guard.test.ts for the sabotage-check
// that keeps this file itself honest). This is a ratchet that can only move
// down through a reviewed diff — not the "delete/skip the gate" pattern
// section 5 of the gap report warns against (REL-001/REL-003).
//
// EXCLUDES:
//   - Lines with `// status-leak-ok`
//   - Test files (*.test.ts(x), *.spec.ts(x))
//   - Declaration files (*.d.ts)
//   - node_modules/, dist/, build/, .next/, coverage/
//   - This file's own doc comment above (not scanned — see SELF_PATH below)
//
// Exit behavior:
//   - Exit 1 if the live violation count exceeds raw-status-leak-baseline.json's maxViolations
//   - Exit 0 otherwise (prints a note if the live count improved on the baseline)
//
// Usage: node scripts/ci/raw-status-leak-guard.mjs
// ─────────────────────────────────────────────────────────────────────────────

import { readdirSync, statSync, readFileSync, existsSync } from "node:fs";
import { join, relative } from "node:path";
import { fileURLToPath } from "node:url";
import { dirname } from "node:path";

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = join(__dirname, "..", "..");
const WEB_SRC_DIR = join(REPO_ROOT, "apps", "web", "src");
const SELF_PATH = fileURLToPath(import.meta.url);
const BASELINE_PATH = join(__dirname, "raw-status-leak-baseline.json");

// ANSI colors
const RED = "\x1b[31m";
const GREEN = "\x1b[32m";
const CYAN = "\x1b[36m";
const RESET = "\x1b[0m";
const BOLD = "\x1b[1m";
const DIM = "\x1b[2m";

// ── 1. File walking ──────────────────────────────────────────────────────────
const SKIP_DIRS = new Set(["node_modules", "dist", "build", ".next", "coverage", ".turbo"]);

function* walkFiles(dir) {
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
      yield* walkFiles(full);
    } else if (entry.isFile() && (entry.name.endsWith(".ts") || entry.name.endsWith(".tsx"))) {
      if (entry.name.endsWith(".d.ts")) continue;
      if (entry.name.endsWith(".test.ts") || entry.name.endsWith(".test.tsx")) continue;
      if (entry.name.endsWith(".spec.ts") || entry.name.endsWith(".spec.tsx")) continue;
      if (full === SELF_PATH) continue;
      yield full;
    }
  }
}

function discoverSourceFiles() {
  if (!existsSync(WEB_SRC_DIR)) return [];
  return [...walkFiles(WEB_SRC_DIR)];
}

// ── 2. Detect raw status-code / raw-failure-text leaks ───────────────────────

// `(${...res.status...})` — a parenthesized template interpolation whose
// expression reads `.status`/`.statusCode` off a response/error-shaped
// variable (res, response, resp, err, error, e, xhr, req, request), e.g.
// `Create failed (${res.status})`. Case-insensitive so `Status`/`STATUS`
// (and PascalCase variables like `e.Status`) count too.
//
// Deliberately narrow in two ways, both to keep this under- rather than
// over-reporting (mirrors money-precision-guard's philosophy):
//   - the property access must look like an HTTP response/error status, not
//     any variable named `status` — a domain object's own `.status` field
//     (e.g. a quotation or work-item status shown in a heading) is exempt.
//   - the allowed character class around the interpolation is narrow (word
//     chars, spaces, a few punctuation marks a plain-language message might
//     use) so this does NOT match a normal function call whose argument
//     list happens to contain a status expression — e.g.
//     `fetchJson(url, fallback, { status })` or a query string built as
//     `` `?status=${status}` `` inside a larger call's parens (those
//     contain commas, backticks, or other call syntax the
//     message-parenthetical shape never does).
const MESSAGE_PAREN_CHARS = `[A-Za-z0-9 :._'"-]`;
const RESPONSE_STATUS_EXPR = `(?:res|response|resp|err|error|e|xhr|req|request)\\.status(?:Code)?\\b`;
const STATUS_IN_PARENS_RE = new RegExp(
  `\\(${MESSAGE_PAREN_CHARS}*\\$\\{[^}]*\\b${RESPONSE_STATUS_EXPR}[^}]*\\}${MESSAGE_PAREN_CHARS}*\\)`,
  "i",
);

// The literal phrase this gap's fix guidance names directly. Word-boundaried
// so it doesn't fire on unrelated identifiers.
const REQUEST_FAILED_LITERAL_RE = /\bRequest failed\b/i;

const SUPPRESS_COMMENT = "status-leak-ok";

export function checkRawStatusLeakViolations(source) {
  const lines = source.split("\n");
  const violations = [];

  lines.forEach((line, idx) => {
    if (line.includes(SUPPRESS_COMMENT)) return;

    if (STATUS_IN_PARENS_RE.test(line)) {
      violations.push({
        line: idx + 1,
        snippet: line.trim().slice(0, 160),
        reason: "raw HTTP status code interpolated into user-facing text",
      });
      return; // one violation per line is enough
    }

    if (REQUEST_FAILED_LITERAL_RE.test(line)) {
      violations.push({
        line: idx + 1,
        snippet: line.trim().slice(0, 160),
        reason: 'literal "Request failed" copy shown to the user',
      });
    }
  });

  return violations;
}

function readBaseline() {
  try {
    const raw = readFileSync(BASELINE_PATH, "utf8");
    const parsed = JSON.parse(raw);
    if (typeof parsed.maxViolations === "number") return parsed.maxViolations;
  } catch {
    // Fall through — no baseline file means zero-tolerance.
  }
  return 0;
}

// ── 3. Run ────────────────────────────────────────────────────────────────────
function main() {
  const files = discoverSourceFiles();
  const allViolations = [];

  for (const file of files) {
    const source = readFileSync(file, "utf8");
    const violations = checkRawStatusLeakViolations(source);
    for (const v of violations) {
      allViolations.push({ file, ...v });
    }
  }

  const baseline = readBaseline();

  console.log("──────────────────────────────────────────────────────────────");
  console.log(`${BOLD}${CYAN}Raw status-leak guard (UX-003)${RESET} — ${files.length} files scanned`);
  console.log(`  Live violations: ${allViolations.length}  |  Baseline (scripts/ci/raw-status-leak-baseline.json): ${baseline}`);
  console.log("");

  if (allViolations.length > 0) {
    for (const v of allViolations) {
      const rel = relative(REPO_ROOT, v.file);
      console.log(`  ${RED}[STATUS-LEAK]${RESET} ${rel}:${v.line} — ${v.reason}`);
      console.log(`      ${DIM}${v.snippet}${RESET}`);
    }
    console.log("");
  }

  if (allViolations.length > baseline) {
    console.log(`  ${RED}${BOLD}❌ ${allViolations.length} violation(s) — exceeds the baseline of ${baseline} (a NEW leak landed).${RESET}`);
    console.log(`  ${RED}Fix: route the failed response through useFormError${RESET}`);
    console.log(`  ${RED}(apps/web/src/lib/useFormError.ts) instead of building the${RESET}`);
    console.log(`  ${RED}message by hand. Suppress a rare false positive with // ${SUPPRESS_COMMENT}.${RESET}`);
    console.log(`  ${RED}See follow-up gap UX-013 in docs/ENTERPRISE-GAP-REPORT-2026-09-07.md.${RESET}`);
    console.log("──────────────────────────────────────────────────────────────");
    process.exit(1);
  }

  if (allViolations.length < baseline) {
    console.log(`  ${GREEN}✅ PASS — ${allViolations.length} < baseline ${baseline}.${RESET}`);
    console.log(`  ${CYAN}Progress! Lower "maxViolations" in raw-status-leak-baseline.json to ${allViolations.length} to lock it in.${RESET}`);
  } else {
    console.log(`  ${GREEN}✅ PASS — ${allViolations.length} violation(s), at the tracked baseline (see UX-013).${RESET}`);
  }
  console.log("──────────────────────────────────────────────────────────────");
  process.exit(0);
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main();
}
