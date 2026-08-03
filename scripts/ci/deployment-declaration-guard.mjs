#!/usr/bin/env node
/**
 * deployment-declaration-guard.mjs
 *
 * Every service in `services/` must be declared in BOTH:
 *   1. ecosystem.config.js        — or it can never be started
 *   2. gateway-service/registry.ts — or no client can ever reach it
 *
 * THE DEFECTS THIS CATCHES
 * -----------------------
 * Measured 2026-07-27 across 41 services:
 *   - `works` and `metadata` were absent from ecosystem.config.js entirely, so
 *     they were undeployable by construction.
 *   - `revenue` and `metadata` had NO gateway route, so every request 404'd.
 *     revenue-service carries the fleet's HIGHEST line coverage (99.6%) and 37
 *     test files, and was completely unreachable from the web app.
 *
 * Neither condition is visible to a per-service test suite or a coverage gate: a
 * service can be fully built, fully tested and scored "Implemented" while being
 * impossible to start or impossible to call. This is a static check because it
 * must hold regardless of whether a fleet is currently running.
 *
 * NOT checked here: whether a declared service is actually RUNNING. That is
 * runtime state and belongs to the L0 readiness lane
 * (tests/quality-program/L0-deployment-readiness).
 *
 * Usage: node scripts/ci/deployment-declaration-guard.mjs
 * Exit:  0 clean, 1 on any undeclared service.
 */
import { readFileSync, existsSync, readdirSync } from "node:fs";
import { join, resolve } from "node:path";

const REPO_ROOT = resolve(import.meta.dirname, "..", "..");
const SERVICES_DIR = join(REPO_ROOT, "services");
const ECOSYSTEM = join(REPO_ROOT, "ecosystem.config.js");
const REGISTRY = join(REPO_ROOT, "services/gateway-service/src/registry.ts");

/**
 * Services that are intentionally not reachable through the gateway. `gateway`
 * IS the edge; `queue` is an internal-only control plane with no public surface.
 * Any other entry needs a written reason.
 */
const NO_GATEWAY_ROUTE_BY_DESIGN = {
  gateway: "is the edge itself",
  queue: "internal control plane — no public surface",
};

function fail(msg) {
  console.error(msg);
  process.exitCode = 1;
}

for (const p of [SERVICES_DIR, ECOSYSTEM, REGISTRY]) {
  if (existsSync(p) === false) {
    console.error(`deployment-declaration-guard: required path missing: ${p}`);
    process.exit(1);
  }
}

const services = readdirSync(SERVICES_DIR)
  .filter((d) => d.endsWith("-service"))
  .map((d) => d.replace("-service", ""))
  .sort();

const eco = readFileSync(ECOSYSTEM, "utf8");
// svc("name", ...) / worker("name", ...) plus inline `name: "x"` app objects.
const declared = new Set([
  ...[...eco.matchAll(/\bsvc\("([a-z-]+)"/g)].map((m) => m[1]),
  ...[...eco.matchAll(/name:\s*"([a-z-]+)"/g)].map((m) => m[1]),
]);

const registry = readFileSync(REGISTRY, "utf8");
const routed = new Set([...registry.matchAll(/upstream\("([a-z-]+)"/g)].map((m) => m[1]));

// Discovery guards: a broken regex must not silently pass an empty set.
if (services.length < 30) fail(`only ${services.length} services discovered — discovery looks broken`);
if (declared.size < 30) fail(`only ${declared.size} ecosystem declarations parsed — parser looks broken`);
if (routed.size < 30) fail(`only ${routed.size} gateway upstreams parsed — parser looks broken`);

const missingFromEcosystem = services.filter((s) => declared.has(s) === false);
const missingFromRegistry = services.filter(
  (s) => routed.has(s) === false && NO_GATEWAY_ROUTE_BY_DESIGN[s] === undefined,
);

console.log("──────────────────────────────────────────────────────────────");
console.log("  Deployment Declaration Guard");
console.log("──────────────────────────────────────────────────────────────");
console.log(`  services in repo        : ${services.length}`);
console.log(`  declared in ecosystem   : ${declared.size}`);
console.log(`  routed via gateway      : ${routed.size}`);
console.log(`  exempt from routing     : ${Object.keys(NO_GATEWAY_ROUTE_BY_DESIGN).join(", ")}`);
console.log("");

if (missingFromEcosystem.length > 0) {
  fail(
    `  UNDEPLOYABLE — ${missingFromEcosystem.length} service(s) absent from ecosystem.config.js:\n` +
      missingFromEcosystem.map((s) => `      ${s}`).join("\n") +
      `\n      A service with no ecosystem entry can never be started, no matter\n` +
      `      how well tested it is. Add an svc() entry.\n`,
  );
}

if (missingFromRegistry.length > 0) {
  fail(
    `  UNREACHABLE — ${missingFromRegistry.length} service(s) have no gateway route:\n` +
      missingFromRegistry.map((s) => `      ${s}`).join("\n") +
      `\n      Every request returns 404 regardless of coverage. Add a prefix to\n` +
      `      services/gateway-service/src/registry.ts, or record an exemption\n` +
      `      with a reason in NO_GATEWAY_ROUTE_BY_DESIGN.\n`,
  );
}


// ── Worker presence (for services already declared in ecosystem) ───────────────
const workerDecls = [...eco.matchAll(/\bworker\("([a-z-]+)"/g)].map((m) => m[1]);
const workerSet = new Set(workerDecls);

/**
 * Extract the full, balanced `worker("<name>", ...)` call starting at
 * `startIdx` (the index of the `w` in `worker(`). A plain regex like
 * `/[^)]*\)/` stops at the FIRST `)`, which is wrong the moment a call
 * contains a nested call with its own parens — e.g. court's worker() call
 * has `scannerDbUrl("court_scanner", ..., "...")` as an object-literal
 * value, so `[^)]*\)` truncated right after that inner `)` and never saw
 * the "dist/worker-main.js" 5th argument or the call's real closing paren.
 * That produced a false positive: a correctly-configured court entry read
 * as missing its dist/worker-main.js override.
 */
function extractBalancedCall(src, startIdx) {
  const openIdx = src.indexOf("(", startIdx);
  if (openIdx === -1) return null;
  let depth = 0;
  for (let i = openIdx; i < src.length; i++) {
    if (src[i] === "(") depth++;
    else if (src[i] === ")") {
      depth--;
      if (depth === 0) return src.slice(startIdx, i + 1);
    }
  }
  return null; // unbalanced — malformed source
}

const courtWorkerStart = eco.indexOf('worker("court"');
if (courtWorkerStart === -1) {
  fail('court has no worker("court", ...) declaration');
} else {
  const call = extractBalancedCall(eco, courtWorkerStart);
  if (call === null) {
    fail('court worker("court", ...) call has unbalanced parentheses — cannot verify');
  } else if (!call.includes('"dist/worker-main.js"')) {
    fail(
      'court worker 5th arg must be "dist/worker-main.js" ' +
        '(export-only dist/worker.js exits immediately)',
    );
  }
}

/** Services declared in ecosystem but intentionally not running a worker yet. */
const NO_WORKER_BY_DESIGN = {
  metadata: "known-not-serving — worker not started until INTERNAL_SERVICE_SECRET rollout",
};

const missingWorkers = [];
for (const s of services) {
  if (declared.has(s) === false) continue; // undeployed scaffolds are reported above
  if (NO_WORKER_BY_DESIGN[s]) continue;
  const svcDir = join(SERVICES_DIR, `${s}-service`);
  const hasWorker =
    existsSync(join(svcDir, "src/worker.ts")) ||
    existsSync(join(svcDir, "src/worker-main.ts"));
  if (hasWorker && workerSet.has(s) === false) {
    missingWorkers.push(s);
  }
}
if (missingWorkers.length) {
  fail(
    `  WORKER MISSING — declared services ship a worker entrypoint but have no worker("…"):\n` +
      missingWorkers.map((s) => `      ${s}`).join("\n") +
      `\n      Queue-first writes will stall without a worker process.\n`,
  );
}
if (declared.has("visitor") && workerSet.has("visitor") === false) {
  fail("  visitor-worker must be declared (queue-first writes)\n");
}
if (declared.has("works") && workerSet.has("works") === false) {
  fail("  works-worker must be declared (queue-first writes)\n");
}

if (process.exitCode === 1) {
  console.log("──────────────────────────────────────────────────────────────");
  process.exit(1);
}

console.log(`  workers declared         : ${workerSet.size}`);
console.log("  CLEAN — every service is both startable and reachable.");
console.log("──────────────────────────────────────────────────────────────");
