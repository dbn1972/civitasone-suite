#!/usr/bin/env node
/**
 * test-ledger-poison-guard.mjs — a test that publishes a HARDCODED messageId
 * against a REAL database must clear it from the idempotency ledger.
 *
 * THE DEFECT THIS CATCHES
 * ----------------------
 * inventory-service tests/batch-consumer.test.ts published two fixed message ids
 * to exercise a concurrent-duplicate race. Its cleanup() deleted serials, batches
 * and items but never touched `_inbox.processed`.
 *
 * `markProcessed(tx, msg.messageId)` returns false for an id it has already seen,
 * and the consumer then RETURNS — no insert, no throw, so no retry and no dead
 * letter either. The first ever run therefore passed, recorded both ids as
 * processed, and every run afterwards found 0 rows and 0 dead letters.
 *
 * Why that is worse than a flaky test: it is deterministic in both directions, it
 * passes the one time anybody watches it, and the transition to broken happens
 * once, silently, in the past. It was carried in the scorecard for weeks as a
 * suspected concurrency defect in the consumer. The consumer was fine.
 *
 * WHY NOTHING ELSE SEES IT
 *   - the test passes on a fresh database, so CI is green on first run
 *   - it fails later with `expected [] to have length 1`, which reads as a
 *     concurrency bug in the code under test
 *   - coverage is unaffected: the file is still "executed"
 *   - no linter models the relationship between a fixed id and a ledger table
 *
 * WHAT IS FLAGGED
 * A test file is a candidate when it BOTH:
 *   1. contains a hardcoded `messageId: "<literal>"`, and
 *   2. does not mock the database or outbox layer
 * and it is a VIOLATION when it does not also delete from the processed ledger.
 *
 * Files that `vi.mock` the db/outbox never reach the ledger, so they are exempt by
 * construction rather than by an allow-list.
 *
 * Usage: node scripts/ci/test-ledger-poison-guard.mjs
 * Exit: 0 clean, 1 on any violation.
 */
import { readdirSync, readFileSync, existsSync, statSync } from "node:fs";
import { join, resolve, relative } from "node:path";

const REPO_ROOT = resolve(import.meta.dirname, "..", "..");
/**
 * Overridable so the L11 canaries can point the guard at a small fixture tree
 * instead of copying all 948 real test files. Not used in CI.
 */
const SERVICES_DIR = process.env.LEDGER_GUARD_SERVICES_DIR
  ? resolve(process.env.LEDGER_GUARD_SERVICES_DIR)
  : join(REPO_ROOT, "services");

/**
 * Files that publish a hardcoded messageId against a real database and are tracked
 * rather than fixed. Held in a committed JSON file, not in this source, for two
 * reasons: each entry carries a written reason that reviewers can diff, and the
 * canaries can supply their own list instead of being unable to test exemption
 * hygiene at all.
 */
const ALLOWLIST_FILE = process.env.LEDGER_GUARD_ALLOWLIST
  ? resolve(process.env.LEDGER_GUARD_ALLOWLIST)
  : join(REPO_ROOT, "scripts/ci/test-ledger-poison-allowlist.json");

let ALLOWED = {};
if (existsSync(ALLOWLIST_FILE)) {
  let parsed;
  try {
    parsed = JSON.parse(readFileSync(ALLOWLIST_FILE, "utf8"));
  } catch (e) {
    console.error(`  FAILED: allow-list is not valid JSON — ${e.message}`);
    process.exit(1);
  }
  // A malformed list must not read as "nothing is exempt AND nothing is stale",
  // which would flip the gate's verdict silently in both directions.
  if (parsed.entries === null || typeof parsed.entries !== "object" || Array.isArray(parsed.entries)) {
    console.error("  FAILED: allow-list is malformed — `entries` must be an object of path -> reason.");
    process.exit(1);
  }
  const unexplained = Object.entries(parsed.entries).filter(
    ([, reason]) => typeof reason !== "string" || reason.trim().length === 0,
  );
  if (unexplained.length > 0) {
    console.error(
      `  FAILED: ${unexplained.length} allow-list entr(ies) have no written reason:\n` +
        unexplained.map(([k]) => `      ${k}`).join("\n"),
    );
    process.exit(1);
  }
  ALLOWED = parsed.entries;
} else {
  console.error(`  FAILED: allow-list not found: ${ALLOWLIST_FILE}`);
  console.error("  Refusing to run — with no list, a tracked file would read as a new violation");
  console.error("  and a genuinely fixed one would never be reported as stale.");
  process.exit(1);
}

/** `messageId: "literal"` — the form people write first. */
const HARDCODED_MSGID = /messageId:\s*["'][^"']+["']/;
/** `messageId: someIdentifier` — needs resolving to see if the value is fixed. */
const MSGID_IDENT = /messageId:\s*([A-Za-z_$][\w$]*)/g;
const UUID_LITERAL = /["'][0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}["']/i;

/**
 * A hardcoded id is just as dangerous when it is bound to a const first.
 *
 * DETECTION GAP THIS CLOSES: the guard originally matched only
 * `messageId: "literal"`. That would NOT have flagged the very file that motivated
 * it — inventory-service's serial-race test, after its ids were lifted into a
 * `RACE_MESSAGE_IDS` constant. It passes for the right reason (it clears the
 * ledger), but the guard would not have noticed if it did not. Detecting only the
 * naive spelling means the guard stops working the moment someone tidies up.
 *
 * Resolves two indirections, which is what tests actually use:
 *   const ID = "uuid";            ... messageId: ID
 *   const IDS = ["uuid", "uuid"]; const [a, b] = IDS; ... messageId: a
 *
 * Deliberately does NOT flag a file merely for containing a uuid literal — tenant
 * and actor ids are hardcoded everywhere and would swamp the signal. The id has to
 * reach `messageId`.
 */
function hasHardcodedMessageIdViaConst(src) {
  const idents = new Set();
  for (const m of src.matchAll(MSGID_IDENT)) idents.add(m[1]);
  if (idents.size === 0) return false;

  const constInit = (name) => {
    const m = new RegExp(`const\\s+${name.replace(/[$]/g, "\\$")}\\b[^=]*=\\s*([^;]{0,400})`).exec(src);
    return m ? m[1] : null;
  };

  for (const name of idents) {
    const init = constInit(name);
    if (init && UUID_LITERAL.test(init)) return true;
  }
  // const [a, b] = SOME_CONST  — the names are bound from an array of literals.
  for (const m of src.matchAll(/const\s*\[([^\]]+)\]\s*=\s*([A-Za-z_$][\w$]*)/g)) {
    const bound = m[1].split(",").map((n) => n.trim());
    if (bound.some((n) => idents.has(n)) === false) continue;
    const init = constInit(m[2]);
    if (init && UUID_LITERAL.test(init)) return true;
  }
  return false;
}
/** A test that mocks the db or the outbox never reaches _inbox.processed. */
const MOCKS_PERSISTENCE = /vi\.mock\(\s*["'][^"']*(shared\/db|shared\/outbox|@civitasone\/outbox|@civitasone\/db)/;
/** Any form of clearing the ledger. */
const CLEARS_LEDGER = /delete\(\s*processed\s*\)|_inbox\.processed|delete\(\s*\w*[Pp]rocessed\w*\s*\)/;

function testFilesFor(svcDir) {
  const testsDir = join(svcDir, "tests");
  if (existsSync(testsDir) === false) return [];
  const out = [];
  const walk = (dir) => {
    for (const entry of readdirSync(dir)) {
      const full = join(dir, entry);
      if (statSync(full).isDirectory()) walk(full);
      else if (entry.endsWith(".test.ts")) out.push(full);
    }
  };
  walk(testsDir);
  return out;
}

const services = existsSync(SERVICES_DIR)
  ? readdirSync(SERVICES_DIR).filter((d) => d.endsWith("-service")).sort()
  : [];

const violations = [];
const exemptSeen = new Set();
let scanned = 0;
let candidates = 0;
let mockedSkipped = 0;

for (const svc of services) {
  for (const file of testFilesFor(join(SERVICES_DIR, svc))) {
    scanned += 1;
    const src = readFileSync(file, "utf8");
    if (HARDCODED_MSGID.test(src) === false && hasHardcodedMessageIdViaConst(src) === false) continue;
    if (MOCKS_PERSISTENCE.test(src)) {
      mockedSkipped += 1;
      continue;
    }
    candidates += 1;
    const rel = relative(SERVICES_DIR, file);
    if (CLEARS_LEDGER.test(src)) continue;
    if (Object.prototype.hasOwnProperty.call(ALLOWED, rel)) {
      exemptSeen.add(rel);
      continue;
    }
    violations.push(rel);
  }
}

// An exemption for a file that no longer qualifies is stale and must be removed,
// or the next file at that path inherits a waiver nobody granted.
const staleExemptions = Object.keys(ALLOWED).filter((k) => exemptSeen.has(k) === false);

console.log("──────────────────────────────────────────────────────────────");
console.log("  Test Ledger Poison Guard");
console.log("──────────────────────────────────────────────────────────────");
console.log(`  test files scanned         : ${scanned}`);
console.log(`  hardcoded messageId, mocked: ${mockedSkipped} (cannot reach the ledger)`);
console.log(`  hardcoded messageId, real  : ${candidates}`);
console.log(`  exemptions matched         : ${exemptSeen.size}/${Object.keys(ALLOWED).length}`);
console.log("");

// A run that inspected nothing must not report success.
if (scanned === 0 || candidates === 0) {
  console.error(
    "  UNMEASURED — no candidate test file was found. Either the tests moved or the\n" +
      "  patterns no longer match. This is not a pass.",
  );
  console.log("──────────────────────────────────────────────────────────────");
  process.exit(1);
}

let rc = 0;
if (violations.length > 0) {
  rc = 1;
  console.error(`  ${violations.length} test file(s) can poison their own idempotency ledger:`);
  for (const v of violations) console.error(`      ${v}`);
  console.error("");
  console.error("  A hardcoded messageId is recorded in _inbox.processed on first run.");
  console.error("  markProcessed() then returns false forever after, and the consumer");
  console.error("  RETURNS rather than throwing — so there is no insert, no error and no");
  console.error("  dead letter. The test passes exactly once per database and fails on");
  console.error("  every run after, with a symptom that looks like a defect in the code");
  console.error("  under test.");
  console.error("");
  console.error("  Fix: delete the ids from the processed ledger in the test's cleanup,");
  console.error("  keeping them in ONE shared constant so the two cannot drift apart.");
  console.error("  Or use a fresh uuid per run if determinism is not required.");
}

if (staleExemptions.length > 0) {
  rc = 1;
  console.error(`  ${staleExemptions.length} stale exemption(s) — the file no longer qualifies:`);
  for (const s of staleExemptions) console.error(`      ${s}`);
  console.error("  Remove them so a future file at that path cannot inherit the waiver.");
}

console.log("──────────────────────────────────────────────────────────────");
if (rc === 0) {
  console.log("  CLEAN — every test that publishes a hardcoded messageId against a real");
  console.log("  database either clears the ledger or is exempt with a written reason.");
  console.log("──────────────────────────────────────────────────────────────");
}
process.exit(rc);
