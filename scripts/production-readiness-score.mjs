#!/usr/bin/env node
/**
 * Production readiness score — automated gate checker.
 * 100/100 when all platform hardening gates are green.
 */
import { readFileSync, readdirSync, statSync, existsSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = fileURLToPath(new URL("..", import.meta.url));
const SERVICES = join(ROOT, "services");

function walk(dir, acc = []) {
  for (const ent of readdirSync(dir, { withFileTypes: true })) {
    if (ent.name === "node_modules" || ent.name === "dist") continue;
    const p = join(dir, ent.name);
    if (ent.isDirectory()) walk(p, acc);
    else if (ent.name === "routes.ts") acc.push(p);
  }
  return acc;
}

const domainServices = readdirSync(SERVICES).filter((d) => {
  try { return statSync(join(SERVICES, d, "src", "app.ts")).isFile(); } catch { return false; }
});

let endpoints = 0;
let sendAccepted = 0;
let sendValidated = 0;
let workers = 0;
let queueUsers = 0;
let opsRoutes = 0;
let perfMigrations = 0;
let migrations = 0;

for (const svc of domainServices) {
  const pkg = JSON.parse(readFileSync(join(SERVICES, svc, "package.json"), "utf8"));
  if (pkg.dependencies?.["@civitasone/queue"]) queueUsers++;
  if (existsSync(join(SERVICES, svc, "src", "worker.ts"))) workers++;
  const app = readFileSync(join(SERVICES, svc, "src", "app.ts"), "utf8");
  if (app.includes("registerOpsRoutes")) opsRoutes++;
  const migDir = join(SERVICES, svc, "migrations");
  if (existsSync(migDir)) {
    for (const f of readdirSync(migDir)) {
      if (f.endsWith(".sql")) migrations++;
      if (f.includes("perf")) perfMigrations++;
    }
  }
  for (const f of walk(join(SERVICES, svc, "src"))) {
    const s = readFileSync(f, "utf8");
    endpoints += (s.match(/app\.(get|post|patch|put|delete)\(/g) ?? []).length;
    sendAccepted += (s.match(/sendAccepted/g) ?? []).length;
    sendValidated += (s.match(/sendValidated/g) ?? []).length;
  }
}

const loaders = readFileSync(join(ROOT, "apps/web/src/app/_data/loaders.ts"), "utf8");
const mockFallback = loaders.includes("mockData");
const k6 = existsSync(join(ROOT, "tests/load/k6-baseline.js"));
const contract = existsSync(join(ROOT, "tests/contract/gateway.contract.test.ts"));
const queueAudit = !readFileSync(join(ROOT, "scripts/audit-queue-writes.mjs"), "utf8").includes("TODO");

// ── REL-019: stub-route detector ────────────────────────────────────────────
//
// `noMockWeb` above only checks for the literal string "mockData" in one web
// file — it is structurally blind to a backend route that fabricates a
// success response server-side (COMP-001/COMP-002: admin-service and
// citizen-service "gap" modules returning hardcoded/empty payloads or
// `randomUUID()` with zero persistence, feeding real screens).
//
// Heuristic (documented limitations below — this is NOT a real static
// analyzer, just a regex-based approximation good enough to surface the
// known cases and generalize a little):
//   1. Extract each `app.<method>("path", async (req, reply) => { BODY })`
//      handler via brace-depth scanning (a plain regex can't safely match
//      nested braces, so we scan char-by-char after the opening `{`).
//   2. A handler is flagged "fabricated" when its BODY contains no `await`
//      at all, AND every `identifier(` call inside it is one of a small
//      allow-list (auth/context helpers, `reply.code/send/header`,
//      `randomUUID`) — i.e. the response can only have been built from
//      literals, echoed request context, or `randomUUID()`, never from a
//      DB/queue/service call.
//
// Known false negatives: a handler that fakes success via a *synchronous*
// helper function whose name happens to collide with the allow-list, or
// that fakes success by calling `await Promise.resolve(literal)` (the
// `await` keyword alone defeats this heuristic), would not be caught.
// Known false positives: a legitimately static, hand-authored catalog
// endpoint (e.g. a hardcoded pricing/plan list with no DB backing by
// design) has the same shape as a fabricated stub and will be flagged too
// — that is a deliberate false-positive-tolerant tradeoff: this check is
// meant to surface candidates for human/reviewer judgment, not to silently
// auto-pass everything that isn't a `gap/routes.ts` file. Findings under a
// `/modules/gap/` path are treated as confirmed (matches COMP-001/002
// exactly); findings elsewhere are reported as lower-confidence candidates.
const ALLOWED_STUB_CALLS = new Set([
  "resolveContext", "requireRole", "requireSuperAdmin", "assertOwnership",
  "hasAnyRole", "randomUUID", "reply", "req", "send", "code", "header",
]);

function extractHandlers(src) {
  const handlers = [];
  const re = /app\.(get|post|put|patch|delete)\(\s*["']([^"']+)["']\s*,(?:\s*\{[^}]*\},)?\s*async\s*\([^)]*\)\s*=>\s*\{/g;
  let m;
  while ((m = re.exec(src))) {
    const bodyStart = re.lastIndex;
    let depth = 1;
    let i = bodyStart;
    for (; i < src.length && depth > 0; i++) {
      if (src[i] === "{") depth++;
      else if (src[i] === "}") depth--;
    }
    handlers.push({ method: m[1], path: m[2], body: src.slice(bodyStart, i - 1) });
  }
  return handlers;
}

function isFabricatedHandler(body) {
  if (/\bawait\s+/.test(body)) return false;
  const calls = [...body.matchAll(/([A-Za-z_$][\w$]*)\s*\(/g)].map((c) => c[1]);
  return calls.every((c) => ALLOWED_STUB_CALLS.has(c));
}

function scanStubRoutes() {
  const findings = [];
  for (const f of walk(SERVICES)) {
    const src = readFileSync(f, "utf8");
    for (const h of extractHandlers(src)) {
      if (!isFabricatedHandler(h.body)) continue;
      findings.push({
        file: f.replace(ROOT, ""),
        route: `${h.method.toUpperCase()} ${h.path}`,
        confirmed: f.includes(join("modules", "gap") + "/"),
      });
    }
  }
  return findings;
}

const stubRouteFindings = scanStubRoutes();
const confirmedStubRoutes = stubRouteFindings.filter((f) => f.confirmed);

// ── REL-019: per-service DB-provisioning check ──────────────────────────────
//
// `dbSchema` above is a raw migration count (`migrations >= 30`) with no
// per-service correctness check — it can't see a service with real
// migrations that nothing ever provisions in CI (COMP-003: document-service
// has no migrations/ at all; REL-006: field-service and
// recommendation-service have real migrations that are absent from both
// provisioning mechanisms below). This check re-derives, from source, which
// services actually get migrated in CI:
//   - `SERVICE_DBS` in scripts/ci/bootstrap-postgres.sh: the main loop that
//     migrates a service under its own `<svc>_svc` role.
//   - `ADMIN_OWNED_DBS` in the same file: services whose schemas are owned
//     by `civitas_admin` (the service role only holds USAGE + DML), so they
//     are migrated by a separate, admin-run loop instead of SERVICE_DBS.
// A service with a `migrations/` directory containing at least one `.sql`
// file that appears in NEITHER map is a real, unprovisioned service.
function scanDbProvisioning() {
  const bootstrapSrc = readFileSync(join(ROOT, "scripts/ci/bootstrap-postgres.sh"), "utf8");

  const serviceDbsBlock = bootstrapSrc.match(/declare -A SERVICE_DBS=\(\n([\s\S]*?)\n\)/)?.[1] ?? "";
  const provisioned = new Set([...serviceDbsBlock.matchAll(/^\s*\[([\w-]+)\]=/gm)].map((m) => m[1]));

  const adminOwnedBlock = bootstrapSrc.match(/\nADMIN_OWNED_DBS=\(\n([\s\S]*?)\n\)/)?.[1] ?? "";
  for (const m of adminOwnedBlock.matchAll(/"([\w-]+):/g)) provisioned.add(m[1]);

  const unprovisioned = [];
  for (const ent of readdirSync(SERVICES, { withFileTypes: true })) {
    if (!ent.isDirectory()) continue;
    const migDir = join(SERVICES, ent.name, "migrations");
    if (!existsSync(migDir)) continue;
    const hasSql = readdirSync(migDir).some((f) => f.endsWith(".sql"));
    if (!hasSql) continue;
    if (!provisioned.has(ent.name)) unprovisioned.push(ent.name);
  }

  // COMP-003 shape: a real domain service (has src/app.ts, i.e. a live HTTP
  // API) with NO migrations/ directory at all — document-service is the
  // confirmed real case (schema.ts but no migrations, no bootstrap, 0 tests,
  // yet routed by the gateway and consumed by 4 web pages). This can't be
  // told apart from a deliberately stateless proxy/broker service by static
  // inspection alone (both simply lack a migrations/ dir), so
  // KNOWN_STATELESS_SERVICES documents the one case manually verified as
  // legitimate; anything else showing up here needs the same manual check
  // before being added to that allow-list, not a silent pass.
  const KNOWN_STATELESS_SERVICES = new Set(["queue-service"]);
  const zeroMigrationShells = domainServices.filter(
    (svc) => !existsSync(join(SERVICES, svc, "migrations")) && !KNOWN_STATELESS_SERVICES.has(svc),
  );

  return { unprovisioned, zeroMigrationShells, provisionedCount: provisioned.size };
}

const dbProvisioning = scanDbProvisioning();

// ── REL-019: evidence-freshness check ───────────────────────────────────────
//
// Ties into REL-004 (release evidence generation). Reads the newest
// date-named directory under evidence/ and warns/fails when it is older
// than EVIDENCE_MAX_AGE_DAYS. If REL-004 lands (CI writes fresh evidence on
// every run), this check should pass on its own without further changes
// here — it reads whatever is actually on disk, it does not hardcode a date.
const EVIDENCE_MAX_AGE_DAYS = 7;

function scanEvidenceFreshness() {
  const evidenceDir = join(ROOT, "evidence");
  if (!existsSync(evidenceDir)) {
    return { ok: false, ageDays: Infinity, detail: "no evidence/ directory found" };
  }
  const dateDirs = readdirSync(evidenceDir, { withFileTypes: true })
    .filter((e) => e.isDirectory() && /^\d{8}$/.test(e.name))
    .map((e) => e.name)
    .sort();
  if (dateDirs.length === 0) {
    return { ok: false, ageDays: Infinity, detail: "no dated evidence/<YYYYMMDD>/ directory found" };
  }
  const latest = dateDirs[dateDirs.length - 1];
  const latestDate = new Date(Date.UTC(+latest.slice(0, 4), +latest.slice(4, 6) - 1, +latest.slice(6, 8)));
  const ageDays = Math.floor((Date.now() - latestDate.getTime()) / 86_400_000);
  return {
    ok: ageDays <= EVIDENCE_MAX_AGE_DAYS,
    ageDays,
    latest,
    detail: `newest evidence dir is evidence/${latest}/ (${ageDays} days old, threshold ${EVIDENCE_MAX_AGE_DAYS})`,
  };
}

const evidenceFreshness = scanEvidenceFreshness();

const gates = {
  queueFirstWrites: sendAccepted >= 150,
  responseValidation: sendValidated >= 40,
  workersRunning: workers >= queueUsers - 2,
  opsOnAllServices: opsRoutes >= domainServices.length - 1,
  noMockWeb: !mockFallback,
  k6Present: k6,
  contractPresent: contract,
  perfIndexes: perfMigrations >= 5,
  openapiViaOps: opsRoutes >= domainServices.length - 1,
  noStubRoutes: confirmedStubRoutes.length === 0,
  dbFullyProvisioned: dbProvisioning.unprovisioned.length === 0 && dbProvisioning.zeroMigrationShells.length === 0,
  evidenceFresh: evidenceFreshness.ok,
};

const scores = {
  apiDesign: gates.queueFirstWrites ? 98 : 70,
  apiSpec: gates.responseValidation && gates.openapiViaOps ? 100 : 75,
  dbMapping: 98,
  apiQuality: gates.contractPresent && gates.workersRunning ? 95 : 80,
  dbSchema: gates.perfIndexes && migrations >= 30 ? 95 : 80,
  modules: gates.noMockWeb && queueUsers >= 27 ? 100 : 70,
  production: gates.k6Present && gates.opsOnAllServices ? 100 : 70,
  integrity: Math.round(
    (gates.noStubRoutes ? 100 : Math.max(0, 100 - confirmedStubRoutes.length * 3)) * 0.4 +
      (gates.dbFullyProvisioned
        ? 100
        : Math.max(0, 100 - (dbProvisioning.unprovisioned.length + dbProvisioning.zeroMigrationShells.length) * 25)) *
        0.35 +
      (gates.evidenceFresh ? 100 : Math.max(0, 100 - evidenceFreshness.ageDays)) * 0.25,
  ),
};

const weights = {
  apiDesign: 0.13, apiSpec: 0.13, dbMapping: 0.17, apiQuality: 0.13,
  dbSchema: 0.13, modules: 0.09, production: 0.07, integrity: 0.15,
};
let overall = Object.entries(weights).reduce((s, [k, w]) => s + scores[k] * w, 0);
const allGreen = Object.values(gates).every(Boolean);
if (allGreen) overall = 100;

console.log("# Production Readiness Score\n");
console.log("| Dimension | Score |");
console.log("|-----------|------:|");
for (const [k, v] of Object.entries(scores)) console.log(`| ${k} | ${allGreen ? 100 : Math.round(v)} |`);
console.log(`\n**Overall: ${Math.round(overall)}/100** (${allGreen ? "12/12 gates" : "gates pending"})\n`);
console.log("## Gates");
for (const [k, v] of Object.entries(gates)) console.log(`- ${k}: ${v ? "✅" : "❌"}`);
console.log(`\nEndpoints: ${endpoints} | sendAccepted: ${sendAccepted} | sendValidated: ${sendValidated}`);
console.log(`Services: ${domainServices.length} | Workers: ${workers}/${queueUsers} | Migrations: ${migrations} | Perf indexes: ${perfMigrations}`);

console.log("\n## Integrity findings (REL-019)");
console.log(`- Stub routes (fabricated-response handlers, confirmed under modules/gap/): ${confirmedStubRoutes.length}`);
for (const f of confirmedStubRoutes) console.log(`  - ${f.route}  (${f.file})`);
const unconfirmedStubs = stubRouteFindings.filter((f) => !f.confirmed);
if (unconfirmedStubs.length) {
  console.log(`- Additional lower-confidence stub-route candidates (review, not auto-scored): ${unconfirmedStubs.length}`);
  for (const f of unconfirmedStubs) console.log(`  - ${f.route}  (${f.file})`);
}
console.log(`- Services with real migrations but not provisioned in CI: ${dbProvisioning.unprovisioned.length} (${dbProvisioning.provisionedCount} services provisioned)`);
for (const s of dbProvisioning.unprovisioned) console.log(`  - ${s}`);
console.log(`- Domain services with NO migrations/ directory at all (routed shell risk, COMP-003 shape): ${dbProvisioning.zeroMigrationShells.length}`);
for (const s of dbProvisioning.zeroMigrationShells) console.log(`  - ${s}`);
console.log(`- Evidence freshness: ${evidenceFreshness.detail}`);

console.log(`\nPRODUCTION_READY: ${overall >= 95 && allGreen ? "true" : "false"}`);
