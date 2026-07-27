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

/**
 * SLO / error-budget thresholds, checked against the k6 summary export.
 * Sourced from steering: sub-200ms p95 reads, error rate >1% = WARN.
 * 500ms is the dev-box threshold; set SLO_STRICT=1 to enforce the 200ms target.
 */
const SLO = {
  p95ReadMs: process.env.SLO_STRICT === "1" ? 200 : 500,
  maxServerErrorRate: 0.01,
  maxRateLimitedRate: 0.20,
};

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

/**
 * Error-budget check from the k6 SLO summary export.
 *
 * A missing artifact is UNMEASURED — reported, and blocking only when
 * --require-slo is passed. It is never silently treated as healthy: "RELEASABLE"
 * must not imply an SLO was verified when no measurement exists.
 */
function evaluateSlo() {
  const file = join(EVIDENCE_DIR, "L7-k6-slo.json");
  if (!existsSync(file)) {
    return {
      status: "UNMEASURED",
      detail: "no L7-k6-slo.json — run scripts/ci/run-slo-measurement.sh",
      metrics: {},
    };
  }

  let summary;
  try {
    summary = JSON.parse(readFileSync(file, "utf8"));
  } catch (e) {
    return { status: "UNMEASURED", detail: `unparseable SLO summary: ${e.message}`, metrics: {} };
  }

  const m = summary.metrics ?? {};
  const p95 = m.read_latency?.["p(95)"];
  const errRate = m.server_error_rate?.rate;
  const limitedRate = m.rate_limited_rate?.rate;
  const reads = m.reachable_reads?.count;

  // No successful reads means the run measured nothing.
  if (!reads || reads <= 0) {
    return {
      status: "UNMEASURED",
      detail: "SLO run recorded 0 successful reads — nothing was measured",
      metrics: { reads: reads ?? 0 },
    };
  }
  if (typeof p95 !== "number") {
    return { status: "UNMEASURED", detail: "SLO summary has no read_latency p(95)", metrics: { reads } };
  }

  const breaches = [];
  if (p95 >= SLO.p95ReadMs) {
    breaches.push(`read p95 ${p95.toFixed(1)}ms >= ${SLO.p95ReadMs}ms`);
  }
  if (typeof errRate === "number" && errRate > SLO.maxServerErrorRate) {
    breaches.push(`5xx rate ${(errRate * 100).toFixed(2)}% > ${(SLO.maxServerErrorRate * 100).toFixed(0)}%`);
  }
  // High limiter interference means the latency figure describes the limiter.
  if (typeof limitedRate === "number" && limitedRate > SLO.maxRateLimitedRate) {
    breaches.push(
      `rate-limited ${(limitedRate * 100).toFixed(1)}% > ${(SLO.maxRateLimitedRate * 100).toFixed(0)}% ` +
        `— latency reflects the limiter, not the read path`,
    );
  }

  const metrics = {
    reads,
    readP95Ms: Number(p95.toFixed(2)),
    serverErrorRate: typeof errRate === "number" ? errRate : null,
    rateLimitedRate: typeof limitedRate === "number" ? limitedRate : null,
    thresholds: SLO,
  };

  if (breaches.length > 0) {
    return { status: "FAIL", detail: breaches.join("; "), metrics };
  }
  return {
    status: "PASS",
    detail: `read p95 ${p95.toFixed(1)}ms < ${SLO.p95ReadMs}ms, 5xx ${((errRate ?? 0) * 100).toFixed(2)}%, ${reads} reads`,
    metrics,
  };
}

const REQUIRE_SLO = args.includes("--require-slo");

const required = REQUIRED_LANES.map(evaluate);
const advisory = ADVISORY_LANES.map(evaluate);
const slo = evaluateSlo();

const blockers = required.filter((l) => l.status !== "PASS");

// An SLO FAIL always blocks. UNMEASURED blocks only under --require-slo, so a
// PR runner without k6 is not forced red — but it can never read as healthy.
if (slo.status === "FAIL") {
  blockers.push({ id: "SLO", priority: "P1", status: "FAIL", detail: slo.detail });
} else if (slo.status === "UNMEASURED" && REQUIRE_SLO) {
  blockers.push({ id: "SLO", priority: "P1", status: "UNMEASURED", detail: slo.detail });
}

const releasable = blockers.length === 0;

if (JSON_OUT) {
  console.log(JSON.stringify({
    evidenceDir: EVIDENCE_DIR,
    releasable,
    required,
    advisory,
    slo,
    sloEnforced: REQUIRE_SLO,
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
console.log(`  SLO / ERROR BUDGET  ${REQUIRE_SLO ? "(enforced)" : "(reported; --require-slo to enforce)"}`);
console.log(`    [${icon(slo.status)}] SLO  ${slo.detail}`);
if (slo.metrics && typeof slo.metrics.readP95Ms === "number") {
  console.log(
    `           reads=${slo.metrics.reads} p95=${slo.metrics.readP95Ms}ms ` +
      `5xx=${((slo.metrics.serverErrorRate ?? 0) * 100).toFixed(2)}% ` +
      `limited=${((slo.metrics.rateLimitedRate ?? 0) * 100).toFixed(1)}%`,
  );
}
console.log("");
console.log("════════════════════════════════════════════════════════════");
if (releasable) {
  console.log("  RELEASABLE — all blocking lanes have passing evidence.");
  if (slo.status === "UNMEASURED") {
    console.log("  NOTE: the SLO was NOT measured in this run. 'RELEASABLE' here means");
    console.log("        the test lanes passed — it does NOT assert a healthy error budget.");
  }
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
