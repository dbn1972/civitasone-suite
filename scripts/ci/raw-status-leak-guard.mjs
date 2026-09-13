#!/usr/bin/env node
// ─────────────────────────────────────────────────────────────────────────────
// raw-status-leak-guard.mjs — UX-003: no raw HTTP status / raw server text in
// user-facing copy.
//
// Scans apps/web/src/**/*.{ts,tsx} for the shapes of leak the gap report
// (docs/ENTERPRISE-GAP-REPORT-2026-09-07.md, UX-003/UX-016/UX-020) calls out:
//
//   1. A message string that embeds a raw status code in a template
//      interpolation, e.g. `Request failed (${res.status})`,
//      `Create failed (${response.status})`, or — since UX-020 — the same
//      interpolation with NO surrounding parens at all, e.g.
//      `` `Error ${res.status}` ``, `` `Server returned ${res.status}` ``.
//      UX-020 found this un-parenthesized shape live in works/ after UX-016
//      had reportedly closed that module: the original regex required a
//      literal `(...)` wrapper, which every UX-003/UX-016 sample happened to
//      have but is not, in fact, load-bearing to the leak.
//   2. `String(res.status)` / `String(response.statusCode)` etc. — a status
//      code coerced straight to a string with no interpolation at all
//      (UX-020: works/execution/record-progress/page.tsx).
//   3. The literal phrase "Request failed" (case-insensitive), which was the
//      dominant copy-pasted leak found across ~91 files at the time this
//      guard was written — even when no status code is interpolated, it is
//      still developer-facing phrasing, not clerk-safe copy. UX-020 widens
//      this to the small family of "<Verb> failed" fallbacks the fleet
//      actually uses (Request/Create/Update/Save/Delete/Submit/Fetch/Upload/
//      Load failed) after finding "Create failed" evade the exact-literal
//      check in the same works/ file as (2).
//
// Fix: run the failed response through the shared `useFormError` hook
// (apps/web/src/lib/useFormError.ts) instead — it maps a backend
// `fieldErrors` array to inline field messages and a `code` to a
// `toHumanError` summary line, and never echoes the status or raw body. A
// non-component/non-hook call site (no React hook rules apply) can call
// `toHumanError` from apps/web/src/lib/messages.ts directly instead — see
// apps/web/src/lib/api/browserClient.ts's `errorMessageFromResponse` (fixed
// under UX-020) for that shape.
//
// Suppress a line deliberately (e.g. a code comment, a log line that never
// reaches the UI) with `// status-leak-ok`.
//
// BASELINE / RATCHET (raw-status-leak-baseline.json):
// UX-003 fixed 4 sampled forms plus the shared hook in one PR; the other
// ~137 files (169 violations at the time this guard was written) are
// tracked as follow-up gap UX-016, not silenced. This guard therefore reads
// a checked-in `maxViolations` from raw-status-leak-baseline.json (sitting
// alongside this script) and only FAILS if the live count exceeds it — i.e.
// it blocks any NEW leak from landing, without pretending the backlog is
// clear. Every UX-016 fix must lower that number in the same PR (see
// tests/architecture/raw-status-leak-guard.test.ts for the sabotage-check
// that keeps this file itself honest). This is a ratchet that can only move
// down through a reviewed diff — not the "delete/skip the gate" pattern
// section 5 of the gap report warns against (REL-001/REL-003).
//
// UX-020 exception to "only moves down": strengthening detection itself (as
// opposed to fixing files) makes previously-invisible TRUE violations
// visible, which necessarily moves the live count UP even though nothing
// regressed. raw-status-leak-baseline.json's own _comment records exactly
// which detection change caused which jump, so a reviewer can tell that
// apart from a real new leak landing at a glance.
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

// `${...res.status...}` — a template interpolation whose expression reads
// `.status`/`.statusCode` off a response/error-shaped variable (res,
// response, resp, err, error, e, xhr, req, request), e.g.
// `Create failed (${res.status})` AND, as of UX-020, the un-parenthesized
// `` `Error ${res.status}` `` / `` `Server returned ${res.status}` `` shape
// found live in works/ (UX-016 reportedly closed works/, but its sample set
// never happened to include this shape, so the pre-UX-020 regex — which
// required a literal `(...)` wrapper around the interpolation — missed it).
// Case-insensitive so `Status`/`STATUS` (and PascalCase variables like
// `e.Status`) count too.
//
// Deliberately narrow in one way, to keep this under- rather than
// over-reporting (mirrors money-precision-guard's philosophy): the property
// access must look like an HTTP response/error status, not any variable
// named `status` — a domain object's own `.status` field (e.g. a quotation
// or work-item status shown in a heading), or a `status` value threaded
// through a query string (`` `?status=${status}` ``), is exempt. UX-020
// deliberately does NOT widen this to a bare, unqualified `${status}` (no
// object prefix): that would catch the two cases above along with the
// intended leak, and the object-prefixed shape already covers all known
// real leaks (see tests/architecture/raw-status-leak-guard.test.ts).
const RESPONSE_STATUS_EXPR = `(?:res|response|resp|err|error|e|xhr|req|request)\\.status(?:Code)?\\b`;
const STATUS_INTERP_RE = new RegExp(`\\$\\{[^}]*\\b${RESPONSE_STATUS_EXPR}[^}]*\\}`, "i");

// `String(res.status)` (UX-020: works/execution/record-progress/page.tsx) —
// the same status expression coerced straight to a string with no
// interpolation syntax at all, so STATUS_INTERP_RE above can't see it.
//
// The trailing `(?!\s*\.)` matters: a fleet dry run without it caught 4 live
// false positives, all the same shape — `String(e.status).toLowerCase() ===
// "healthy"` (admin/api-monitoring, admin/editions, admin/entitlements) —
// a domain object's own status coerced to a string purely so it can be
// lowercase-compared, never shown to a user. The record-progress leak this
// check targets instead passes `String(res.status)` straight to `new
// Error(...)` with nothing chained after it. Requiring "not immediately
// followed by a property/method access" separates the two shapes without
// needing a real parser. A future genuine leak that chains a method after
// `String(res.status)` before showing it would evade this — narrower than
// STATUS_INTERP_RE deliberately, same under- vs over-report tradeoff as the
// rest of this file; suppress a rare miss's *false positive* twin with
// // status-leak-ok, same as any other check here.
const STATUS_STRING_CALL_RE = new RegExp(`\\bString\\(\\s*${RESPONSE_STATUS_EXPR}\\s*\\)(?!\\s*\\.)`, "i");

// The literal phrase(s) this gap's fix guidance names. Word-boundaried so
// this doesn't fire on unrelated identifiers. UX-003 named "Request failed"
// specifically (the dominant copy-pasted leak at the time); UX-020 widens
// this to the small, enumerated family of "<Verb> failed" fallback strings
// actually found in the fleet (works/execution/record-progress/page.tsx's
// `?? "Create failed"` evaded the exact-literal check by using a different
// verb). Deliberately an explicit verb list, not a generic `[A-Z]\w+ failed`
// — this stays predictable and auditable rather than firing on any prose
// that happens to contain a capitalized word before "failed". Deliberately
// excludes "Fetch": a fleet-wide dry run of this exact list including
// "Fetch" turned up two live false positives, both prose in comments
// ("Previously this fetch failed silently…", "...every create failed
// validation" in a JSDoc block) rather than user-facing copy — "fetch" reads
// as ordinary English far more often than the other verbs here, which are
// all specific CRUD-ish actions. The comment skip below (COMMENT_LINE_RE)
// closes that same hole for every check, but the fleet run is the only
// evidence available for which verbs are actually worth the residual risk,
// so the list stays to the verbs that showed a real hit.
const FAILED_LITERAL_RE = /\b(?:Request|Create|Update|Save|Delete|Submit|Upload|Load) failed\b/i;

const SUPPRESS_COMMENT = "status-leak-ok";

// A line that is (or continues) a `//` or `/* … */`/JSDoc comment. This
// guard has always been line-based, not a real parser, so it can only
// approximate "is this shown to the user" with "is this a comment" — good
// enough given the fleet dry run above found every comment hit was
// developer prose describing past/fixed behavior, never copy a clerk would
// see. Checked first, before any leak pattern, so it applies uniformly to
// all three checks below rather than needing its own guard at each site.
const COMMENT_LINE_RE = /^\s*(?:\/\/|\/\*|\*(?!\/))/;

export function checkRawStatusLeakViolations(source) {
  const lines = source.split("\n");
  const violations = [];

  lines.forEach((line, idx) => {
    if (line.includes(SUPPRESS_COMMENT)) return;
    if (COMMENT_LINE_RE.test(line)) return;

    if (STATUS_INTERP_RE.test(line)) {
      violations.push({
        line: idx + 1,
        snippet: line.trim().slice(0, 160),
        reason: "raw HTTP status code interpolated into user-facing text",
      });
      return; // one violation per line is enough
    }

    if (STATUS_STRING_CALL_RE.test(line)) {
      violations.push({
        line: idx + 1,
        snippet: line.trim().slice(0, 160),
        reason: "raw HTTP status code coerced to a string for user-facing text",
      });
      return;
    }

    const failedMatch = line.match(FAILED_LITERAL_RE);
    if (failedMatch) {
      violations.push({
        line: idx + 1,
        snippet: line.trim().slice(0, 160),
        reason: `literal "${failedMatch[0]}" copy shown to the user`,
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
    console.log(`  ${RED}See follow-up gap UX-016 in docs/ENTERPRISE-GAP-REPORT-2026-09-07.md.${RESET}`);
    console.log("──────────────────────────────────────────────────────────────");
    process.exit(1);
  }

  if (allViolations.length < baseline) {
    console.log(`  ${GREEN}✅ PASS — ${allViolations.length} < baseline ${baseline}.${RESET}`);
    console.log(`  ${CYAN}Progress! Lower "maxViolations" in raw-status-leak-baseline.json to ${allViolations.length} to lock it in.${RESET}`);
  } else {
    console.log(`  ${GREEN}✅ PASS — ${allViolations.length} violation(s), at the tracked baseline (see UX-016).${RESET}`);
  }
  console.log("──────────────────────────────────────────────────────────────");
  process.exit(0);
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main();
}
