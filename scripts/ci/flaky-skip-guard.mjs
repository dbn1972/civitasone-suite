#!/usr/bin/env node
// ─────────────────────────────────────────────────────────────────────────────
// flaky-skip-guard.mjs — REL-014: the flaky-test policy has no enforcement.
//
// THE GAP THIS CLOSES
// --------------------
// Before this guard, a test could be hard-skipped (`it.skip`/`describe.skip`/
// `.todo`/`xdescribe`/`xit`/`xtest`) or conditionally skipped on an unset env
// var (`.skipIf(...)`) with zero tracking: no required reason, no ticket, no
// expiry, and no report anyone would actually see — the only trace was a
// single grey line buried in hundreds of pages of CI scrollback. A skip added
// to make a red build green could sit there indefinitely, silently, and
// nobody would know it was there without reading every test file by hand.
//
// WHAT THIS GUARD DOES
// ---------------------
//   (a) INVENTORY — walks the whole tree for skip-shaped calls and ratchets
//       the result against a committed baseline (scripts/ci/flaky-skip-
//       baseline.json), exactly like tenant-index-guard.mjs / schema-drift-
//       guard.mjs: fails on a NEW skip that was not added to the baseline via
//       --write-baseline (so it cannot land un-reviewed) and on a STALE
//       baseline entry (fixed/un-skipped but left listed). The baseline IS
//       the visible report — it is a normal, diffable file, not scrollback.
//       This job also writes the same report to $GITHUB_STEP_SUMMARY when
//       running in Actions, so it shows up on the PR/run page itself.
//   (b) GOVERNANCE — independent of baseline membership, every matched skip
//       must carry a `// FLAKY-SKIP: <reason> (expires: YYYY-MM-DD)` comment,
//       either trailing on the same line or alone on the line directly above.
//       `expires` is optional but a skip with an expired date is treated as
//       UNGOVERNED again — same "expiring allow-list" mechanic as
//       scripts/ci/cve-audit-gate.mjs's `expires` field: silence is not
//       permanent, by construction. A skip with neither a real reason nor an
//       expiry fails, per REL-014's brief.
//
// WHAT IS EXEMPT
// A Playwright-style *conditional* `test.skip(someRuntimeCondition, "msg")` —
// first argument is not a string literal, i.e. it is not naming a test, it is
// a runtime precondition — already carries its reason as that call's own
// second argument (Playwright surfaces it in every report), so it does not
// need a duplicate `FLAKY-SKIP` comment PROVIDED a second (message) argument
// is actually present. `test.skip(cond)` with no message argument gets no
// free pass and is governed like everything else. This is a real, permanent,
// by-design runtime guard clause (e.g. "skip if today's seeded data has no
// low-stock item to forecast against") — categorically different from a
// hidden broken/flaky test, so it is inventoried for visibility but not asked
// to carry a fabricated expiry.
//
// Usage:
//   node scripts/ci/flaky-skip-guard.mjs                 # check (CI mode)
//   node scripts/ci/flaky-skip-guard.mjs --write-baseline # regenerate baseline
// Exit: 0 clean, 1 on any violation (or if the scan found nothing at all).
// ─────────────────────────────────────────────────────────────────────────────

import { readFileSync, writeFileSync, readdirSync, existsSync, appendFileSync } from "node:fs";
import { join, dirname, relative } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = join(__dirname, "..", "..");
const BASELINE_FILE = join(REPO_ROOT, "scripts/ci/flaky-skip-baseline.json");

const EXCLUDE_DIRS = new Set(["node_modules", "dist", "build", ".turbo", "coverage", ".git", ".next", "out"]);
const TEST_FILE_RE = /\.(test|spec)\.(ts|tsx|js|jsx)$/;
// tests/architecture/ holds the CI guards' OWN fixture-based unit tests (this
// guard's included) — deterministic pure-function tests against in-memory
// strings, not application/integration suites the flaky-test policy is
// about. It is excluded by path rather than by directory NAME (unlike
// node_modules/dist/etc above) because "architecture" isn't inherently
// exclude-worthy elsewhere. Concretely: without this, THIS guard's own test
// fixtures — string literals like '"describe.skipIf(...)"' used to exercise
// classifySkipOccurrence() — get re-matched by the guard's real scan as if
// they were live skip calls, self-polluting the inventory.
const EXCLUDE_PATH_PREFIXES = ["tests/architecture/"];

// ── Pure logic (exported for tests/architecture/flaky-skip-guard.test.ts) ──

/** `.skipIf(` is unambiguous — always a vitest conditional-skip modifier. */
const SKIPIF_RE = /\.skipIf\(/;
/** `xdescribe(`/`xit(`/`xtest(` — always an unconditional hard skip. */
const X_PREFIXED_RE = /(^|[^A-Za-z0-9_])(xdescribe|xit|xtest)\(/;
/** `.todo(` has no conditional form in vitest or Playwright — always hard. */
const TODO_RE = /\b(describe|it|test)\.todo\(/;
/** `.skip(` — ambiguous: `it.skip("name", fn)` (hard) vs Playwright's
 *  `test.skip(condition, "msg")` (runtime-conditional). Disambiguated by
 *  whether the character right after the paren opens a string literal. */
const SKIP_RE = /\b(describe|it|test)\.skip\(/;

/**
 * Classifies (at most) one skip-shaped occurrence on a single source line.
 * `windowLines` is the same short lookahead window callers already build for
 * extractTitle() below (the match line plus a few following lines) — needed
 * here too because a hard `it.skip("name", fn)` is sometimes formatted with
 * the name on a following line rather than trailing `.skip(` on the match
 * line itself:
 *   it.skip(
 *     "some flaky test",
 *     () => {...},
 *   );
 * Without looking past the match line, `after` (below) is empty and the call
 * falls through to "runtime-conditional" — which then rides the Playwright
 * self-documented exemption for free via hasSecondArgument()'s loose comma
 * check, silently requiring zero FLAKY-SKIP justification for a genuine hard
 * skip (REL-040). Defaults to a single-line window so existing single-
 * argument call sites/tests (which only care about the match line) are
 * unaffected.
 * Returns null when the line has none.
 */
export function classifySkipOccurrence(line, windowLines = [line]) {
  if (SKIPIF_RE.test(line)) return { kind: "env-gated", label: "skipIf" };
  if (X_PREFIXED_RE.test(line)) return { kind: "hard", label: "x-prefixed" };
  if (TODO_RE.test(line)) return { kind: "hard", label: ".todo" };
  const sm = SKIP_RE.exec(line);
  if (sm) {
    // Same lookahead trick as extractTitle(): join whatever trails the
    // `.skip(` token on the match line with any following window lines, then
    // trim — so a name/condition starting on the next line is seen as
    // immediately following the call, same as on the same line. When the
    // match line itself has real (non-whitespace) content after `.skip(`,
    // trimStart() never reaches past it, so this is a no-op for the common
    // single-line case.
    const tail = [line.slice(sm.index + sm[0].length), ...windowLines.slice(1)].join("\n");
    const after = tail.trimStart();
    const isNamedTest = /^["'`]/.test(after);
    return { kind: isNamedTest ? "hard" : "runtime-conditional", label: `${sm[1]}.skip` };
  }
  return null;
}

/** Best-effort human label for a baseline key: the first quoted string (>=6
 *  chars) in the match line plus a few lines of lookahead, which in practice
 *  is always the test/describe title (vitest) or the Playwright skip reason. */
export function extractTitle(windowLines) {
  const joined = windowLines.join("\n");
  const m = /["'`]([^"'`]{6,200})["'`]/.exec(joined);
  return m ? m[1] : null;
}

/** Cheap check for "was a second (message) argument actually passed" —
 *  just a comma appearing before the statement's closing paren, scanned
 *  across a short lookahead window. Good enough to stop a bare
 *  `test.skip(cond)` (no message) from riding the conditional exemption. */
export function hasSecondArgument(windowLines) {
  return /,/.test(windowLines.join("\n").slice(0, 400));
}

const TAG_RE = /\/\/\s*FLAKY-SKIP:\s*(.*)$/;
const EXPIRES_RE = /\bexpires:\s*(\d{4}-\d{2}-\d{2})\b/i;

/** Parses a `// FLAKY-SKIP: <reason> (expires: YYYY-MM-DD)` comment. */
export function parseGovernanceTag(line) {
  if (!line) return null;
  const m = TAG_RE.exec(line);
  if (!m) return null;
  const raw = m[1].trim();
  const expiresMatch = EXPIRES_RE.exec(raw);
  const expires = expiresMatch ? expiresMatch[1] : null;
  const reason = raw
    .replace(/\(?\s*expires:\s*\d{4}-\d{2}-\d{2}\s*\)?/i, "")
    .replace(/^[-—|,\s]+|[-—|,\s]+$/g, "")
    .trim();
  return { reason, expires, raw };
}

/**
 * Evaluates a parsed governance tag against today's date (YYYY-MM-DD, so
 * this is a plain lexicographic — and therefore chronological — compare).
 *   "missing" — no FLAKY-SKIP comment at all
 *   "empty"   — comment present but carries neither a reason nor an expiry
 *   "expired" — expiry date has passed; treated as ungoverned again
 *   "ok"      — governed
 */
export function evaluateGovernance(tag, todayISO) {
  if (!tag) return { status: "missing" };
  const hasReason = tag.reason.length >= 8;
  const hasExpiry = Boolean(tag.expires);
  if (!hasReason && !hasExpiry) return { status: "empty" };
  if (hasExpiry && tag.expires < todayISO) return { status: "expired", expires: tag.expires };
  return { status: "ok" };
}

// ── File walking (exercised only by running the real guard, like the other
//    guards' own traversal logic — see test-ledger-poison-guard.mjs) ───────

function walk(dir, out) {
  // withFileTypes avoids a separate statSync per entry — some service seed/
  // dirs (e.g. services/location-service/seed/*) carry symlinks out to a
  // sibling checkout that is not guaranteed to exist in every worktree/CI
  // runner, and statSync on a broken link throws ENOENT. Dirent's own
  // isDirectory()/isFile() reflect the link's un-resolved type, so a broken
  // (or merely absent-here) symlink is just skipped rather than crashing the
  // whole scan.
  for (const dirent of readdirSync(dir, { withFileTypes: true })) {
    if (EXCLUDE_DIRS.has(dirent.name)) continue;
    const full = join(dir, dirent.name);
    if (dirent.isDirectory()) walk(full, out);
    else if (dirent.isFile() && TEST_FILE_RE.test(dirent.name)) out.push(full);
  }
}

function scanRepo() {
  const all = [];
  walk(REPO_ROOT, all);
  const files = all
    .filter((abs) => {
      const rel = relative(REPO_ROOT, abs).split("\\").join("/");
      return !EXCLUDE_PATH_PREFIXES.some((p) => rel.startsWith(p));
    })
    .sort();

  const todayISO = new Date().toISOString().slice(0, 10);
  const entries = [];
  const violations = [];

  for (const abs of files) {
    const rel = relative(REPO_ROOT, abs).split("\\").join("/");
    const lines = readFileSync(abs, "utf8").split("\n");
    for (let i = 0; i < lines.length; i++) {
      const window = lines.slice(i, Math.min(i + 4, lines.length));
      const match = classifySkipOccurrence(lines[i], window);
      if (!match) continue;

      const title = extractTitle(window);
      const key = `${rel}::${title ?? `L${i + 1}`}`;

      let governance;
      if (match.kind === "runtime-conditional" && hasSecondArgument(window)) {
        governance = { status: "self-documented" };
      } else {
        const sameLineTag = parseGovernanceTag(lines[i]);
        const prevLineTag = sameLineTag ? null : parseGovernanceTag(lines[i - 1]);
        governance = evaluateGovernance(sameLineTag ?? prevLineTag, todayISO);
      }

      const entry = { key, file: rel, line: i + 1, kind: match.kind, title, governance };
      entries.push(entry);

      if (["missing", "empty", "expired"].includes(governance.status)) {
        violations.push({ entry, reason: governance.status });
      }
    }
  }

  return { files, entries, violations, todayISO };
}

// ── Baseline ratchet ────────────────────────────────────────────────────────

function loadBaseline() {
  if (!existsSync(BASELINE_FILE)) return null;
  try {
    return JSON.parse(readFileSync(BASELINE_FILE, "utf8"));
  } catch (e) {
    console.error(`  FAILED: baseline is not valid JSON — ${e.message}`);
    process.exit(1);
  }
}

function writeBaseline(entries) {
  const hardSkipCount = entries.filter((e) => e.kind === "hard").length;
  const envGatedCount = entries.filter((e) => e.kind === "env-gated").length;
  const runtimeConditionalCount = entries.filter((e) => e.kind === "runtime-conditional").length;
  const payload = {
    $comment:
      "TRACKED DEBT, not an approved state. Each entry is a test that is hard-skipped " +
      "(.skip/.todo/xdescribe/xit/xtest), env-gated (.skipIf on an unset var/unreachable " +
      "dependency), or a Playwright runtime-conditional test.skip(condition, message). " +
      "REL-014: this file is the inventory scripts/ci/flaky-skip-guard.mjs ratchets " +
      "against — it fails on a NEW skip not listed here, and on a STALE entry (no longer " +
      "a skip in source). Every hard/env-gated entry must ALSO carry its own inline " +
      "// FLAKY-SKIP: <reason> (expires: YYYY-MM-DD) comment at the call site — this file " +
      "tracks identity and count so the total cannot silently grow, it does not replace " +
      "the inline requirement. Regenerate with --write-baseline after " +
      "adding/removing/un-skipping a test. See docs/ENTERPRISE-GAP-REPORT-2026-09-07.md REL-014.",
    generatedAt: new Date().toISOString().slice(0, 10),
    hardSkipCount,
    envGatedCount,
    runtimeConditionalCount,
    count: entries.length,
    entries: entries
      .map((e) => ({ key: e.key, file: e.file, kind: e.kind }))
      .sort((a, b) => a.key.localeCompare(b.key)),
  };
  writeFileSync(BASELINE_FILE, JSON.stringify(payload, null, 2) + "\n");
  return payload;
}

// ── Report + main ───────────────────────────────────────────────────────────

function buildReport({ files, entries, violations, todayISO }, baseline, driftViolations) {
  const lines = [];
  lines.push("──────────────────────────────────────────────────────────────");
  lines.push("  Flaky-Skip Guard (REL-014)");
  lines.push("──────────────────────────────────────────────────────────────");
  lines.push(`  test files scanned      : ${files.length}`);
  lines.push(`  hard skips found        : ${entries.filter((e) => e.kind === "hard").length}`);
  lines.push(`  env-gated (skipIf) found: ${entries.filter((e) => e.kind === "env-gated").length}`);
  lines.push(`  runtime-conditional found: ${entries.filter((e) => e.kind === "runtime-conditional").length}`);
  lines.push(`  total inventoried       : ${entries.length}`);
  if (baseline) {
    lines.push(`  baseline (committed)    : ${baseline.count} (generated ${baseline.generatedAt})`);
  }
  lines.push("");

  if (entries.length > 0) {
    lines.push("  Full inventory:");
    for (const e of entries) {
      const status = e.governance.status;
      const marker = status === "ok" || status === "self-documented" ? "OK" : status.toUpperCase();
      lines.push(`    [${marker.padEnd(9)}] ${e.kind.padEnd(20)} ${e.file}:${e.line}  ${e.title ?? ""}`);
    }
    lines.push("");
  }

  if (violations.length > 0) {
    lines.push(`  ${violations.length} skip(s) with no governing reason/expiry:`);
    for (const v of violations) {
      lines.push(`      ${v.entry.file}:${v.entry.line} — ${v.reason} (${v.entry.title ?? "untitled"})`);
    }
    lines.push("");
    lines.push("  Fix: add `// FLAKY-SKIP: <reason> (expires: YYYY-MM-DD)` on the line above");
    lines.push("  (or trailing on the same line) as the skip/skipIf/todo call.");
    lines.push("");
  }

  if (driftViolations.new.length > 0) {
    lines.push(`  ${driftViolations.new.length} skip(s) NEW — not yet in the committed baseline:`);
    for (const e of driftViolations.new) lines.push(`      ${e.key}`);
    lines.push("  Run: node scripts/ci/flaky-skip-guard.mjs --write-baseline, then commit the diff.");
    lines.push("");
  }
  if (driftViolations.stale.length > 0) {
    lines.push(`  ${driftViolations.stale.length} baseline entr(ies) STALE — no longer a skip in source:`);
    for (const k of driftViolations.stale) lines.push(`      ${k}`);
    lines.push("  Run: node scripts/ci/flaky-skip-guard.mjs --write-baseline, then commit the diff.");
    lines.push("");
  }

  lines.push("──────────────────────────────────────────────────────────────");
  return lines.join("\n");
}

function main() {
  const writeMode = process.argv.includes("--write-baseline");
  const scan = scanRepo();

  if (scan.files.length === 0) {
    console.error("  UNMEASURED — no test file was found at all. This is not a pass.");
    process.exit(1);
  }

  if (writeMode) {
    const written = writeBaseline(scan.entries);
    console.log(`Wrote ${BASELINE_FILE} — ${written.count} entries ` +
      `(${written.hardSkipCount} hard, ${written.envGatedCount} env-gated, ${written.runtimeConditionalCount} runtime-conditional).`);
    process.exit(0);
  }

  const baseline = loadBaseline();
  if (!baseline) {
    console.error(`  FAILED: baseline not found: ${BASELINE_FILE}`);
    console.error("  Run: node scripts/ci/flaky-skip-guard.mjs --write-baseline");
    process.exit(1);
  }
  const baselineKeys = new Set((baseline.entries ?? []).map((e) => e.key));
  const currentKeys = new Set(scan.entries.map((e) => e.key));

  const driftViolations = {
    new: scan.entries.filter((e) => !baselineKeys.has(e.key)),
    stale: [...baselineKeys].filter((k) => !currentKeys.has(k)),
  };

  const report = buildReport(scan, baseline, driftViolations);
  console.log(report);

  if (process.env.GITHUB_STEP_SUMMARY) {
    try {
      appendFileSync(process.env.GITHUB_STEP_SUMMARY, "\n```\n" + report + "\n```\n");
    } catch {
      // best-effort only — never fail the gate over the summary write
    }
  }

  const rc = scan.violations.length > 0 || driftViolations.new.length > 0 || driftViolations.stale.length > 0 ? 1 : 0;
  if (rc === 0) {
    console.log("  CLEAN — every skip is inventoried in the baseline and carries a governing reason/expiry.");
    console.log("──────────────────────────────────────────────────────────────");
  }
  process.exit(rc);
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main();
}
