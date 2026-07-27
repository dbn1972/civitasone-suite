#!/usr/bin/env node
/**
 * release-gate.mjs — Section D release gate.
 *
 * Answers one question: has every P0/P1 lane produced EVIDENCE of a pass in this
 * run? It does not re-run tests; it audits the evidence pack. A lane with no
 * artifact is treated as UNMEASURED and blocks the release — "pass without an
 * artifact = fail" (B5).
 *
 * Reads JUnit XML from evidence/<date>/ (or --evidence <dir>) and enforces:
 *   1. Every REQUIRED lane has an artifact  (missing => UNMEASURED => block)
 *   2. Zero failures / errors in every lane
 *   3. Every lane recorded at least one test (an empty suite is not a pass)
 *
 * Exit 0 = releasable. Exit 1 = blocked. Never exits 0 on missing evidence.
 *
 * Usage:
 *   node scripts/ci/release-gate.mjs
 *   node scripts/ci/release-gate.mjs --evidence evidence/20260727
 *   node scripts/ci/release-gate.mjs --json
 */
import { readFileSync, existsSync, readdirSync } from "node:fs";
import { join, resolve } from "node:path";

const args = process.argv.slice(2);
const JSON_OUT = args.includes("--json");
const evIdx = args.indexOf("--evidence");
const REPO_ROOT = resolve(import.meta.dirname, "..", "..");

/** P0/P1 lanes that MUST have evidence before a release is allowed. */
const REQUIRED_LANES = [
  { id: "L1", name: "Tenant Isolation", priority: "P0" },
  { id: "L2", name: "Authz / BOLA", priority: "P0" },
  { id: "L3", name: "Data & Schema Integrity", priority: "P0" },
  { id: "L4", name: "API Contract & Input", priority: "P1" },
  { id: "L6", name: "Security", priority: "P1" },
  { id: "L10", name: "Domain Correctness", priority: "P0" },
  { id: "L11", name: "Mutation & Canary", priority: "META" },
];

/** Lanes that are reported but do not block (P2). */
const ADVISORY_LANES = [
  { id: "L7", name: "Reliability", priority: "P2" },
  { id: "L8", name: "AI Features", priority: "P2" },
];

function todayDir() {
  const d = new Date();
  const stamp = `${d.getUTCFullYear()}${String(d.getUTCMonth() + 1).padStart(2, "0")}${String(d.getUTCDate()).padStart(2, "0")}`;
  return join(REPO_ROOT, "evidence", stamp);
}

const EVIDENCE_DIR = evIdx !== -1 && args[evIdx + 1]
  ? resolve(args[evIdx + 1])
  : todayDir();

/**
 * Parse the <testsuites>/<testsuite> attributes from a JUnit file.
 * Returns aggregate counts, or null when the file is unreadable/not JUnit.
 */
function parseJUnit(file) {
  let xml;
  try {
    xml = readFileSync(file, "utf8");
  } catch {
    return null;
  }
  const suiteRe = /<testsuite\b[^>]*>/g;
  let tests = 0, failures = 0, errors = 0, skipped = 0, suites = 0;
  let m;
  while ((m = suiteRe.exec(xml)) !== null) {
    const tag = m[0];
    const num = (attr) => {
      const mm = tag.match(new RegExp(`${attr}="(\\d+)"`));
      return mm ? Number(mm[1]) : 0;
    };
    suites += 1;
    tests += num("tests");
    failures += num("failures");
    errors += num("errors");
    skipped += num("skipped");
  }
  if (suites === 0) return null;
  return { tests, failures, errors, skipped };
}

/** Find the artifact for a lane: any *.xml whose name contains the lane id. */
function findLaneArtifact(laneId) {
  if (!existsSync(EVIDENCE_DIR)) return null;
  const files = readdirSync(EVIDENCE_DIR).filter((f) => f.endsWith(".xml"));
  // Match L3 but not L10/L11: require a non-digit (or end) after the id.
  const re = new RegExp(`(^|[^0-9A-Za-z])${laneId}([^0-9]|$)`, "i");
  const hit = files.find((f) => re.test(f));
  return hit ? join(EVIDENCE_DIR, hit) : null;
}

function evaluate(lane) {
  const artifact = findLaneArtifact(lane.id);
  if (!artifact) {
    return { ...lane, status: "UNMEASURED", detail: "no evidence artifact found" };
  }
  const parsed = parseJUnit(artifact);
  if (!parsed) {
    return { ...lane, status: "UNMEASURED", detail: `unparseable artifact: ${artifact}` };
  }
  if (parsed.tests === 0) {
    return { ...lane, status: "UNMEASURED", detail: "artifact records 0 tests (empty suite is not a pass)" };
  }
  const bad = parsed.failures + parsed.errors;
  if (bad > 0) {
    return { ...lane, status: "FAIL", detail: `${bad} failure(s)/error(s) of ${parsed.tests} tests`, ...parsed };
  }
  return { ...lane, status: "PASS", detail: `${parsed.tests} tests passed`, ...parsed };
}

const required = REQUIRED_LANES.map(evaluate);
const advisory = ADVISORY_LANES.map(evaluate);

const blockers = required.filter((l) => l.status !== "PASS");
const releasable = blockers.length === 0;

if (JSON_OUT) {
  console.log(JSON.stringify({
    evidenceDir: EVIDENCE_DIR,
    releasable,
    required,
    advisory,
    blockers: blockers.map((b) => ({ id: b.id, status: b.status, detail: b.detail })),
  }, null, 2));
  process.exit(releasable ? 0 : 1);
}

const icon = (s) => (s === "PASS" ? "PASS " : s === "FAIL" ? "FAIL " : "UNMEA");

console.log("════════════════════════════════════════════════════════════");
console.log("  CivitasOne — Release Gate");
console.log(`  Evidence: ${EVIDENCE_DIR}`);
console.log("════════════════════════════════════════════════════════════");
if (!existsSync(EVIDENCE_DIR)) {
  console.log("  Evidence directory does not exist.");
}
console.log("");
console.log("  BLOCKING LANES (P0/P1)");
for (const l of required) {
  console.log(`    [${icon(l.status)}] ${l.id.padEnd(4)} ${l.priority.padEnd(5)} ${l.name.padEnd(26)} ${l.detail}`);
}
console.log("");
console.log("  ADVISORY LANES (P2 — reported, non-blocking)");
for (const l of advisory) {
  console.log(`    [${icon(l.status)}] ${l.id.padEnd(4)} ${l.priority.padEnd(5)} ${l.name.padEnd(26)} ${l.detail}`);
}
console.log("");
console.log("════════════════════════════════════════════════════════════");
if (releasable) {
  console.log("  RELEASABLE — all blocking lanes have passing evidence.");
  console.log("  Remaining work is human: UAT acceptance + policy sign-off.");
} else {
  console.log(`  BLOCKED — ${blockers.length} blocking lane(s) not proven:`);
  for (const b of blockers) {
    console.log(`    - ${b.id} (${b.priority}): ${b.status} — ${b.detail}`);
  }
  console.log("");
  console.log("  UNMEASURED is treated as a block: a lane with no artifact has");
  console.log("  not demonstrated anything. Run the lane and re-check.");
}
console.log("════════════════════════════════════════════════════════════");

process.exit(releasable ? 0 : 1);
