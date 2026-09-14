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
// tracked as follow-up gap UX-016, not silenced.
//
// UX-024 FOLLOW-UP (2026-09-14) — keyed entries, not an aggregate count.
// This guard used to check ONLY `allViolations.length <= maxViolations`, an
// aggregate with no entry identity. That let a PR introduce a genuinely NEW
// leak while bumping `maxViolations` by the same amount in the same diff —
// the count still fit "under budget," so the guard passed clean with no
// warning. That is precisely the failure class that let a real leak
// (apps/web/src/lib/crm/documents.ts:271, dating to PR #463) sit undetected
// for over a month before UX-024 found it by manual review rather than by
// this gate — see docs/ENTERPRISE-GAP-REPORT-2026-09-07.md UX-024 for the
// CI-timing investigation.
//
// Fixed by porting the keyed-entry ratchet scripts/ci/schema-drift-guard.mjs
// and scripts/ci/tenant-index-guard.mjs use — and, for a same-category
// pure-source-text scanner (no live DB involved),
// scripts/ci/nested-tx-guard.mjs, whose own "RATCHET" doc comment named this
// exact maxViolations-count gap before it was closed here. Every violation
// now gets a stable identity key, `<file relative to repo root>:<line>`, and
// raw-status-leak-baseline.json checks in the full `entries` list rather
// than a count. The gate fails on:
//   - a NEW entry — a live violation whose key is not in the checked-in
//     baseline, regardless of whether the total count would still fit under
//     the old maxViolations number (that field, and the whole notion of a
//     "budget," are gone — there is nothing left to silently bump). This
//     also catches a baselined entry that is still genuinely live in the
//     code but was quietly deleted from the baseline file: from this
//     guard's point of view that is indistinguishable from a brand-new
//     leak, so it fails the same way, by design.
//   - a STALE entry — a key still listed in the baseline that no longer
//     matches any live violation. Either it was really fixed (regenerate
//     the baseline with --write-baseline in the same PR, so the fix can't
//     be silently reverted for free), or it was never a real violation (a
//     fabricated/padded entry) — either way it cannot sit in the file
//     unexamined.
// `count` in the baseline is informational only (kept equal to
// entries.length for a human skimming the diff) and is never itself
// compared, so it cannot be "bumped" to paper over a new entry.
//
// UX-020 exception to "only ever moves down" still applies, to entries now
// instead of to a count: strengthening detection itself (as opposed to
// fixing files) makes previously-invisible TRUE violations visible, which
// adds baseline entries even though nothing regressed.
// raw-status-leak-baseline.json's own _comment records exactly which
// detection change caused which jump, so a reviewer can tell that apart
// from a real new leak landing at a glance.
//
// EXCLUDES:
//   - Lines with `// status-leak-ok`
//   - Test files (*.test.ts(x), *.spec.ts(x))
//   - Declaration files (*.d.ts)
//   - node_modules/, dist/, build/, .next/, coverage/
//   - This file's own doc comment above (not scanned — see SELF_PATH below)
//
// Exit behavior:
//   - Exit 1 if any live violation's key is not in the checked-in baseline
//     (a NEW leak), or if any baselined key no longer matches a live
//     violation (a STALE entry — fixed, or never real).
//   - Exit 0 otherwise.
//
// Usage:
//   node scripts/ci/raw-status-leak-guard.mjs                  # guard: exit 1 on
//                                                                # new/stale baseline entries
//   node scripts/ci/raw-status-leak-guard.mjs --write-baseline  # regenerate the baseline
//                                                                # from the current tree
//                                                                # (keeps the existing
//                                                                # _comment; only recomputes
//                                                                # entries/count/generatedAt)
// ─────────────────────────────────────────────────────────────────────────────

import { readdirSync, statSync, readFileSync, existsSync, writeFileSync } from "node:fs";
import { join, relative } from "node:path";
import { fileURLToPath } from "node:url";
import { dirname } from "node:path";

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = join(__dirname, "..", "..");
const WEB_SRC_DIR = join(REPO_ROOT, "apps", "web", "src");
const SELF_PATH = fileURLToPath(import.meta.url);
const BASELINE_PATH = join(__dirname, "raw-status-leak-baseline.json");

// UX-024: keyed-entry ratchet (mirrors schema-drift-guard.mjs /
// tenant-index-guard.mjs / nested-tx-guard.mjs), not the old
// maxViolations-count style. See this file's own top doc comment.
const WRITE_BASELINE = process.argv.includes("--write-baseline");

// ANSI colors
const RED = "\x1b[31m";
const GREEN = "\x1b[32m";
const YELLOW = "\x1b[33m";
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

// Read the checked-in baseline. Returns { entries: Set<string>, raw: object|null }.
//
// A MISSING file means zero known debt (empty Set) — every live violation
// will show as NEW. That is correct fail-closed behavior, not a silent pass.
//
// A file that EXISTS but is not valid JSON, or whose `entries` is not an
// array, is a HARD error (never silently treated as "no known debt") — the
// same defensive posture schema-drift-guard.mjs takes, because reading a
// malformed baseline as empty is the exact unreachable-failure-condition bug
// class this programme exists to prevent, and it would otherwise dump a
// confusing wall of ~210 false "NEW" violations instead of one clear
// "fix your baseline file" message.
function readBaseline() {
  if (!existsSync(BASELINE_PATH)) return { entries: new Set(), raw: null };
  let raw;
  try {
    raw = JSON.parse(readFileSync(BASELINE_PATH, "utf8"));
  } catch (e) {
    console.error(`${RED}FAILED: ${relative(REPO_ROOT, BASELINE_PATH)} is not valid JSON — ${e.message}${RESET}`);
    process.exit(1);
  }
  if (!Array.isArray(raw.entries)) {
    console.error(
      `${RED}FAILED: ${relative(REPO_ROOT, BASELINE_PATH)} is malformed — \`entries\` must be an array.${RESET}\n` +
        `  Regenerate it with: node scripts/ci/raw-status-leak-guard.mjs --write-baseline`,
    );
    process.exit(1);
  }
  // Obsolete since UX-024 — never read for pass/fail, but a stray leftover is
  // worth calling out loudly rather than letting it sit unexplained.
  if (typeof raw.maxViolations === "number") {
    console.log(
      `  ${YELLOW}WARNING: ${relative(REPO_ROOT, BASELINE_PATH)} still has a "maxViolations" field ` +
        `(${raw.maxViolations}).${RESET}\n` +
        `  ${YELLOW}It is obsolete and IGNORED — this guard compares entry identity, not a count.${RESET}\n` +
        `  ${YELLOW}Regenerate with --write-baseline to drop it.${RESET}`,
    );
  }
  return { entries: new Set(raw.entries), raw };
}

// ── 3. Run ────────────────────────────────────────────────────────────────────
function main() {
  const files = discoverSourceFiles();
  const allViolations = [];

  for (const file of files) {
    const rel = relative(REPO_ROOT, file);
    const source = readFileSync(file, "utf8");
    const violations = checkRawStatusLeakViolations(source);
    for (const v of violations) {
      allViolations.push({ file, rel, key: `${rel}:${v.line}`, ...v });
    }
  }

  console.log("──────────────────────────────────────────────────────────────");
  console.log(`${BOLD}${CYAN}Raw status-leak guard (UX-003)${RESET} — ${files.length} files scanned`);

  // ── --write-baseline: regenerate from the current tree ──────────────────
  // Keeps the existing baseline's `_comment` verbatim (it is hand-written
  // institutional memory of the whole ratchet's history, not something to
  // regenerate away) and only recomputes the mechanically-derived fields.
  if (WRITE_BASELINE) {
    const entries = allViolations.map((v) => v.key).sort();
    let prevComment;
    try {
      prevComment = JSON.parse(readFileSync(BASELINE_PATH, "utf8"))._comment;
    } catch {
      prevComment = undefined;
    }
    const baseline = {
      _comment:
        prevComment ??
        "TRACKED DEBT, not an approved state. Each entry is a <file>:<line> that leaks " +
          "a raw HTTP status code or raw failure copy to the user (UX-003). The gate " +
          "fails on NEW entries and on stale entries (fixed, or never real, but still " +
          "listed). Burn these down; regenerate with --write-baseline after a real fix. " +
          "See UX-016/UX-020/UX-024 in docs/ENTERPRISE-GAP-REPORT-2026-09-07.md.",
      generatedAt: new Date().toISOString().slice(0, 10),
      count: entries.length,
      entries,
    };
    writeFileSync(BASELINE_PATH, JSON.stringify(baseline, null, 2) + "\n");
    console.log(`  ${GREEN}Wrote ${entries.length} entries to ${relative(REPO_ROOT, BASELINE_PATH)}${RESET}`);
    console.log("──────────────────────────────────────────────────────────────");
    process.exit(0);
  }

  // ── Ratchet comparison against the checked-in baseline ───────────────────
  const { entries: baselineKeys } = readBaseline();
  const currentKeys = new Set(allViolations.map((v) => v.key));
  const novel = allViolations.filter((v) => !baselineKeys.has(v.key));
  const stale = [...baselineKeys].filter((k) => !currentKeys.has(k)).sort();
  const knownDebt = allViolations.filter((v) => baselineKeys.has(v.key));

  console.log(
    `  Live violations: ${allViolations.length}  |  baselined: ${knownDebt.length}  |  ` +
      `NEW: ${novel.length}  |  stale: ${stale.length}`,
  );
  console.log("");

  if (allViolations.length > 0) {
    for (const v of allViolations) {
      const isNew = !baselineKeys.has(v.key);
      const tag = isNew ? `  ${RED}<-- NEW, not in baseline${RESET}` : "";
      console.log(`  ${isNew ? RED : YELLOW}[STATUS-LEAK]${RESET} ${v.key}${tag} — ${v.reason}`);
      console.log(`      ${DIM}${v.snippet}${RESET}`);
    }
    console.log("");
  }

  let failed = false;

  if (novel.length > 0) {
    console.log(`  ${RED}${BOLD}FAIL${RESET} — ${novel.length} NEW violation(s) not in the checked-in baseline (marked above).`);
    console.log(`  ${RED}Fix: route the failed response through useFormError${RESET}`);
    console.log(`  ${RED}(apps/web/src/lib/useFormError.ts) instead of building the${RESET}`);
    console.log(`  ${RED}message by hand. Suppress a rare false positive with // ${SUPPRESS_COMMENT}.${RESET}`);
    console.log(`  ${RED}A key also shows as NEW if a still-live baselined entry was quietly${RESET}`);
    console.log(`  ${RED}deleted from raw-status-leak-baseline.json without being fixed — that is${RESET}`);
    console.log(`  ${RED}deliberate: this guard cannot tell the two apart, by design.${RESET}`);
    console.log(`  ${RED}See follow-up gap UX-016 in docs/ENTERPRISE-GAP-REPORT-2026-09-07.md.${RESET}`);
    failed = true;
  }

  if (stale.length > 0) {
    console.log(
      `  ${RED}${BOLD}FAIL${RESET} — ${stale.length} baselined entr${stale.length === 1 ? "y" : "ies"} ` +
        `no longer match a live violation:`,
    );
    for (const k of stale) console.log(`      ${GREEN}${k}${RESET}  (fixed, or never real — remove from baseline)`);
    console.log(`  ${RED}Regenerate so a real fix can't be silently reverted for free, and so a${RESET}`);
    console.log(`  ${RED}fabricated entry can't sit in the file unexamined:${RESET}`);
    console.log(`      node scripts/ci/raw-status-leak-guard.mjs --write-baseline`);
    failed = true;
  }

  if (!failed) {
    console.log(
      `  ${GREEN}${BOLD}PASS${RESET} — no new violations, baseline is accurate ` +
        `(${knownDebt.length} tracked debt entries remain — see UX-016).`,
    );
  }
  console.log("──────────────────────────────────────────────────────────────");
  process.exit(failed ? 1 : 0);
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main();
}
