#!/usr/bin/env node
// ─────────────────────────────────────────────────────────────────────────────
// queue-publish-messageid-guard.mjs — PERF-008: every queue.publish() call
// site must pass an explicit `messageId`.
//
// THE DEFECT THIS CATCHES
// ------------------------
// `Queue.publish<T>(topic, input: PublishInput<T>, options?)`
// (services/queue-service/src/bus.ts) auto-generates a random messageId
// (`input.messageId ?? randomUUID()`) when the caller omits one — so every
// message DOES get an id, and this is NOT "messages have no id" the way the
// original gap report's evidence text could be read. The REAL gap: a retry
// of the SAME logical publish call (a caller re-invoking queue.publish after
// a failure, a request handler retried by its own caller, etc.) with no
// explicit messageId gets a FRESH random uuid every attempt, which defeats
// message-id-keyed idempotent dedup on the consumer side (markProcessed()/
// the inbox `_inbox.processed` table, keyed on messageId). outbox's own
// relayOnce (packages/outbox/src/index.ts) already gets this right — it
// forwards the stable outbox row id as messageId specifically so a
// crash-and-republish reuses the same id — but nothing enforces every OTHER
// direct queue.publish() call site (i.e. one not going through outbox) does
// the same.
//
// CHECK: for every CallExpression shaped like `<expr>.publish(topic, input,
// ...)` where `input` is an object literal whose properties structurally
// fingerprint it as a PublishInput (see FINGERPRINT_KEYS below — chosen to
// avoid false-positives from an unrelated `.publish(...)` method elsewhere
// in this codebase, e.g. a "publish this document/page" domain action),
// flag it if that object literal has no `messageId` property.
//
// DELIBERATELY NARROW, same under- vs over-report tradeoff as
// money-precision-guard.mjs / raw-status-leak-guard.mjs:
//   - Only looks at object-LITERAL 2nd arguments. `queue.publish(topic,
//     someVariable)` cannot be judged by this guard without real data-flow
//     analysis (does `someVariable` have messageId set somewhere above?) —
//     under-reported rather than guessed at. A `--report` run prints these
//     as "unknown (non-literal argument)" separately from real violations
//     so a human can spot-check them; they are never counted in the
//     baseline/ratchet.
//   - The FINGERPRINT_KEYS check requires BOTH `correlationId` AND `payload`
//     among the object's own properties (not spread-inherited) — this is
//     the one combination every real PublishInput call site in this fleet
//     has and no unrelated `.publish(...)` call happened to collide with in
//     a fleet-wide dry run (see this guard's own PR description for the
//     count before/after tightening).
//
// BASELINE / RATCHET (queue-publish-messageid-baseline.json): keyed-entry
// ratchet from day one (schema-drift-guard.mjs / tenant-index-guard.mjs /
// raw-status-leak-guard.mjs's post-UX-024 shape) — see raw-status-leak-guard.mjs's
// own header for why an aggregate count is never used here. The gate fails on:
//   - a NEW entry (a live violation whose key is not in the checked-in
//     baseline), regardless of whether the total count would still fit
//     under some budget — there is no budget.
//   - a STALE entry (a key still listed in the baseline that no longer
//     matches a live violation) — either really fixed (regenerate the
//     baseline with --write-baseline in the same PR) or never real; either
//     way it cannot sit in the file unexamined.
//
// Suppress a specific line deliberately (e.g. a call site that is provably
// not retried, or is itself test/fixture infrastructure) with
// `// perf008-messageid-ok: <reason>` on the same line as the `.publish(`.
//
// EXCLUDES: test files (*.test.ts(x), *.spec.ts(x)), declaration files
// (*.d.ts), node_modules/, dist/, build/, .next/, coverage/, .turbo/.
//
// Usage:
//   node scripts/ci/queue-publish-messageid-guard.mjs                  # guard
//   node scripts/ci/queue-publish-messageid-guard.mjs --report         # print full violation list (+ unknowns), does not affect exit code
//   node scripts/ci/queue-publish-messageid-guard.mjs --write-baseline # regenerate the baseline from the current tree
// ─────────────────────────────────────────────────────────────────────────────
import { readdirSync, statSync, readFileSync, existsSync, writeFileSync } from "node:fs";
import { join, relative, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import ts from "typescript";

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = join(__dirname, "..", "..");
const SELF_PATH = fileURLToPath(import.meta.url);
const BASELINE_PATH = join(__dirname, "queue-publish-messageid-baseline.json");

const WRITE_BASELINE = process.argv.includes("--write-baseline");
const REPORT = process.argv.includes("--report");

const RED = "\x1b[31m";
const GREEN = "\x1b[32m";
const YELLOW = "\x1b[33m";
const CYAN = "\x1b[36m";
const RESET = "\x1b[0m";
const BOLD = "\x1b[1m";
const DIM = "\x1b[2m";

const SCAN_DIRS = ["services", "packages"];
const SKIP_DIRS = new Set(["node_modules", "dist", "build", ".next", "coverage", ".turbo"]);
const SUPPRESS_RE = /perf008-messageid-ok/;

// Both properties must be own properties of the object literal (not just
// spread in) for a call site to count as a real PublishInput fingerprint.
const FINGERPRINT_KEYS = ["correlationId", "payload"];

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
  const files = [];
  for (const d of SCAN_DIRS) {
    const dir = join(REPO_ROOT, d);
    if (existsSync(dir)) files.push(...walkFiles(dir));
  }
  return files;
}

function objectLiteralOwnPropertyNames(objLit) {
  const names = new Set();
  for (const prop of objLit.properties) {
    if (ts.isSpreadAssignment(prop)) continue; // spread contents are unknown statically
    if (
      (ts.isPropertyAssignment(prop) || ts.isShorthandPropertyAssignment(prop) || ts.isMethodDeclaration(prop)) &&
      prop.name &&
      (ts.isIdentifier(prop.name) || ts.isStringLiteral(prop.name))
    ) {
      names.add(prop.name.text);
    }
  }
  return names;
}

/**
 * Find every `<expr>.publish(topic, input, ...)` call in `sourceFile`.
 * Returns { violations, unknowns } — violations are literal-argument calls
 * fingerprinted as PublishInput with no messageId; unknowns are `.publish(`
 * calls whose 2nd argument isn't a literal this guard can judge (reported,
 * never baselined).
 */
function checkFile(sourceFile) {
  const violations = [];
  const unknowns = [];
  // Every `<expr>.publish(...)` call with >=2 args this guard even looked
  // at, regardless of category — the honest denominator for "N of M publish
  // call sites miss messageId" (M is NOT the same as a plain grep count of
  // the text ".publish(" fleet-wide, which also matches unrelated methods —
  // see this guard's own header for why that distinction matters).
  let totalMatched = 0;

  function visit(node) {
    if (
      ts.isCallExpression(node) &&
      ts.isPropertyAccessExpression(node.expression) &&
      node.expression.name.text === "publish" &&
      node.arguments.length >= 2
    ) {
      const { line } = sourceFile.getLineAndCharacterOfPosition(node.getStart());
      const lineText = sourceFile.text.split("\n")[line] ?? "";
      if (!SUPPRESS_RE.test(lineText)) {
        totalMatched++;
        const input = node.arguments[1];
        if (ts.isObjectLiteralExpression(input)) {
          const propNames = objectLiteralOwnPropertyNames(input);
          const isFingerprinted = FINGERPRINT_KEYS.every((k) => propNames.has(k));
          if (isFingerprinted && !propNames.has("messageId")) {
            violations.push({ line: line + 1, snippet: lineText.trim().slice(0, 160) });
          }
        } else {
          // Non-literal 2nd argument (identifier, spread call result, etc.) —
          // cannot be judged statically. Still worth surfacing under --report
          // so a human can spot-check it, but never counted as a violation.
          unknowns.push({ line: line + 1, snippet: lineText.trim().slice(0, 160) });
        }
      }
    }
    ts.forEachChild(node, visit);
  }
  visit(sourceFile);
  return { violations, unknowns, totalMatched };
}

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
        `  Regenerate it with: node scripts/ci/queue-publish-messageid-guard.mjs --write-baseline`,
    );
    process.exit(1);
  }
  return { entries: new Set(raw.entries), raw };
}

function main() {
  const files = discoverSourceFiles();
  const allViolations = [];
  const allUnknowns = [];
  let totalMatched = 0;

  for (const file of files) {
    const rel = relative(REPO_ROOT, file);
    const text = readFileSync(file, "utf8");
    const sourceFile = ts.createSourceFile(file, text, ts.ScriptTarget.Latest, true, file.endsWith(".tsx") ? ts.ScriptKind.TSX : ts.ScriptKind.TS);
    const result = checkFile(sourceFile);
    for (const v of result.violations) allViolations.push({ file, rel, key: `${rel}:${v.line}`, ...v });
    for (const u of result.unknowns) allUnknowns.push({ file, rel, key: `${rel}:${u.line}`, ...u });
    totalMatched += result.totalMatched;
  }

  console.log("──────────────────────────────────────────────────────────────");
  console.log(`${BOLD}${CYAN}Queue publish messageId guard (PERF-008)${RESET} — ${files.length} files scanned`);
  console.log(`  Total \`.publish(topic, <>, ...)\` call sites matched: ${totalMatched} (fingerprinted PublishInput violations + compliant + unknown/non-literal)`);

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
        "TRACKED DEBT, not an approved state. Each entry is a <file>:<line> `queue.publish(...)` call " +
          "site (object-literal 2nd argument, fingerprinted as PublishInput via correlationId+payload) " +
          "with no explicit messageId — a retry mints a fresh random id, defeating consumer-side " +
          "idempotent dedup. The gate fails on NEW entries and on stale entries (fixed, or never real, " +
          "but still listed). Burn these down; regenerate with --write-baseline after a real fix. " +
          "See PERF-008 in docs/ENTERPRISE-GAP-REPORT-2026-09-07.md.",
      generatedAt: new Date().toISOString().slice(0, 10),
      count: entries.length,
      entries,
    };
    writeFileSync(BASELINE_PATH, JSON.stringify(baseline, null, 2) + "\n");
    console.log(`  ${GREEN}Wrote ${entries.length} entries to ${relative(REPO_ROOT, BASELINE_PATH)}${RESET}`);
    console.log("──────────────────────────────────────────────────────────────");
    process.exit(0);
  }

  const { entries: baselineKeys } = readBaseline();
  const currentKeys = new Set(allViolations.map((v) => v.key));
  const novel = allViolations.filter((v) => !baselineKeys.has(v.key));
  const stale = [...baselineKeys].filter((k) => !currentKeys.has(k)).sort();
  const knownDebt = allViolations.filter((v) => baselineKeys.has(v.key));

  console.log(
    `  Live violations: ${allViolations.length}  |  baselined: ${knownDebt.length}  |  ` +
      `NEW: ${novel.length}  |  stale: ${stale.length}  |  unknown (non-literal, unscored): ${allUnknowns.length}`,
  );
  console.log("");

  if (REPORT) {
    for (const v of allViolations) console.log(`  ${YELLOW}[MESSAGEID-MISSING]${RESET} ${v.key} — ${v.snippet}`);
    for (const u of allUnknowns) console.log(`  ${DIM}[unknown]${RESET} ${u.key} — ${u.snippet}`);
  } else if (allViolations.length > 0) {
    for (const v of allViolations) {
      const isNew = !baselineKeys.has(v.key);
      const tag = isNew ? `  ${RED}<-- NEW, not in baseline${RESET}` : "";
      console.log(`  ${isNew ? RED : YELLOW}[MESSAGEID-MISSING]${RESET} ${v.key}${tag}`);
      console.log(`      ${DIM}${v.snippet}${RESET}`);
    }
    console.log("");
  }

  let failed = false;

  if (novel.length > 0) {
    console.log(`  ${RED}${BOLD}FAIL${RESET} — ${novel.length} NEW violation(s) not in the checked-in baseline (marked above).`);
    console.log(`  ${RED}Fix: pass an explicit, stable messageId (see packages/outbox/src/index.ts's${RESET}`);
    console.log(`  ${RED}relayOnce for the pattern — forward a stable id from whatever this publish is${RESET}`);
    console.log(`  ${RED}for, so a retry reuses it). Suppress a rare false positive with // ${SUPPRESS_RE.source}.${RESET}`);
    failed = true;
  }

  if (stale.length > 0) {
    console.log(
      `  ${RED}${BOLD}FAIL${RESET} — ${stale.length} baselined entr${stale.length === 1 ? "y" : "ies"} ` +
        `no longer match a live violation:`,
    );
    for (const k of stale) console.log(`      ${GREEN}${k}${RESET}  (fixed, or never real — remove from baseline)`);
    console.log(`  ${RED}Regenerate: node scripts/ci/queue-publish-messageid-guard.mjs --write-baseline${RESET}`);
    failed = true;
  }

  if (!failed) {
    console.log(
      `  ${GREEN}${BOLD}PASS${RESET} — no new violations, baseline is accurate ` +
        `(${knownDebt.length} tracked debt entries remain).`,
    );
  }
  console.log("──────────────────────────────────────────────────────────────");
  process.exit(failed ? 1 : 0);
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main();
}

export { checkFile, objectLiteralOwnPropertyNames };
