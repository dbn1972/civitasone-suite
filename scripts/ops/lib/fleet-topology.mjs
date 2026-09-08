// fleet-topology.mjs — PERF-001
//
// Derives the PM2 fleet's real connection-budget shape DIRECTLY from
// ecosystem.config.js, instead of a hand-maintained literal.
//
// WHY THIS FILE EXISTS: PERF-001 (see docs/ENTERPRISE-GAP-REPORT-2026-09-07.md)
// was a REGRESSION of an earlier "C2" connection-budget fix. That fix hardcoded
// `DB_BACKED_SERVICES = 33` into tests/security/connection-budget.test.ts and
// a 33-name `KNOWN_SERVICES` array (using a `civitas_${svc}` naming
// CONVENTION, not the real per-service db name) into
// scripts/ops/verify-pgbouncer-routing.mjs. The fleet then grew to 65
// DB-backed services and neither number was ever revisited — nothing failed,
// nothing caught it, and the ecosystem.config.js wiring this budget depends
// on quietly reverted to direct-Postgres connections. Deriving the topology
// from ecosystem.config.js itself means the budget tests and the
// live-routing verifier can never again silently drift out of sync with the
// fleet they're supposed to be budgeting for.
//
// This module also fixes the SAME class of bug one level deeper: the old
// `dbNameFor(svc) => \`civitas_${svc}\`` / `envVarFor(svc) =>
// \`DATABASE_URL_${svc.toUpperCase()}\`` helpers ASSUMED every service's
// Postgres identifiers are a mechanical transform of its PM2 process name.
// That's true for 64 of 65 services but not `ai-agent` — its PM2 name is
// hyphenated ("ai-agent") while its real db user/name/env-var are
// underscored (`ai_agent_svc` / `civitas_ai_agent` /
// `DATABASE_URL_AI_AGENT`), because its ecosystem.config.js entry was hand-
// written with different naming for the process vs. the database. The old
// convention-based helpers would have silently produced "civitas_ai-agent"
// for the compliance report, which never matches a real `pg_stat_activity`
// row — ai-agent-service's connections would have been dropped from
// scripts/ops/verify-pgbouncer-routing.mjs's report with no error, ever.
// Reading the real (dbUser, dbName) pair out of each app's rendered
// DATABASE_URL, instead of guessing it from the process name, fixes that.
//
// Loads ecosystem.config.js (CommonJS) with NODE_ENV forced non-production
// for the duration of the require — every dbUrl()/scannerDbUrl()/piiKey()/
// requireSecret() helper in that file fails closed (throws) under
// NODE_ENV=production unless real secrets are injected. It also clears
// DATABASE_URL / DATABASE_URL_<SVC> / *_SCANNER_DATABASE_URL from the
// process env for the duration of the require: ecosystem.config.js's
// dbUrl()/scannerDbUrl() treat any of those as an "injected" override that
// short-circuits the per-service derivation, and vitest.config.mjs sets a
// single global `DATABASE_URL` for the whole test run — without clearing it
// here, every single service would resolve to that ONE stubbed URL and this
// module would report a fleet of one, silently.
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(__dirname, "../../..");

/**
 * @typedef {Object} ServiceEntry
 * @property {string} name - PM2 short name (e.g. "identity", "ai-agent")
 * @property {string} dbUser - real Postgres role (e.g. "ai_agent_svc")
 * @property {string} dbName - real Postgres database (e.g. "civitas_ai_agent")
 * @property {string} envVar - real per-service override env var (e.g. "DATABASE_URL_AI_AGENT")
 *
 * @typedef {Object} FleetTopology
 * @property {number} processCount - total PM2 apps (svc + worker + non-DB apps like "web")
 * @property {number} svcCount
 * @property {number} workerCount
 * @property {ServiceEntry[]} services - one entry per distinct DB-backed service (svc+worker share one)
 * @property {string[]} serviceNames - services[].name, sorted (kept for callers that only need names)
 * @property {number} dbBackedPoolCount - distinct (dbUser, dbName) pairs opened by svc()/worker() (main pools)
 * @property {number} scannerPoolCount - distinct *_SCANNER_DATABASE_URL entries actually wired today
 * @property {number} totalPoolCount - dbBackedPoolCount + scannerPoolCount (distinct PgBouncer [user,db] pools)
 */

const ENV_KEYS_TO_CLEAR = /^DATABASE_URL($|_)|_SCANNER_DATABASE_URL$/;

/** @returns {FleetTopology} */
export function loadFleetTopology() {
  const previousNodeEnv = process.env.NODE_ENV;
  const cleared = {};
  for (const key of Object.keys(process.env)) {
    if (ENV_KEYS_TO_CLEAR.test(key)) {
      cleared[key] = process.env[key];
      delete process.env[key];
    }
  }
  process.env.NODE_ENV = "test"; // any non-"production" value takes the dev-fallback path

  let apps;
  try {
    const require = createRequire(import.meta.url);
    const ecosystemPath = resolve(REPO_ROOT, "ecosystem.config.js");
    delete require.cache[require.resolve(ecosystemPath)];
    apps = require(ecosystemPath).apps;
  } finally {
    if (previousNodeEnv === undefined) delete process.env.NODE_ENV;
    else process.env.NODE_ENV = previousNodeEnv;
    for (const [key, value] of Object.entries(cleared)) process.env[key] = value;
  }

  let svcCount = 0;
  let workerCount = 0;
  /** @type {Map<string, ServiceEntry>} */
  const services = new Map(); // keyed by PM2 short name
  const dbPools = new Set(); // "dbUser@dbName"
  let scannerPoolCount = 0;

  for (const app of apps) {
    const isWorker = app.name.endsWith("-worker");
    if (isWorker) workerCount++;
    else svcCount++;

    const url = app.env?.DATABASE_URL;
    if (typeof url !== "string" || url.length === 0) continue; // e.g. "web" — not DB-backed

    const match = url.match(/^postgres:\/\/([^:]+):[^@]*@[^/]+\/([^?]+)/);
    if (!match) continue;
    const [, dbUser, dbName] = match;
    dbPools.add(`${dbUser}@${dbName}`);

    const shortName = isWorker ? app.name.slice(0, -"-worker".length) : app.name;
    if (!services.has(shortName)) {
      // Mirrors ecosystem.config.js's own dbUrl(): svcKey = dbUser minus a
      // trailing "_svc", uppercased — the REAL env var name that service's
      // DATABASE_URL_<SVC> override would use, not a guess from the PM2 name.
      const svcKey = dbUser.replace(/_svc$/, "").toUpperCase();
      services.set(shortName, { name: shortName, dbUser, dbName, envVar: `DATABASE_URL_${svcKey}` });
    }

    for (const key of Object.keys(app.env ?? {})) {
      if (key.endsWith("_SCANNER_DATABASE_URL")) scannerPoolCount++;
    }
  }

  const serviceList = [...services.values()].sort((a, b) => a.name.localeCompare(b.name));

  return {
    processCount: apps.length,
    svcCount,
    workerCount,
    services: serviceList,
    serviceNames: serviceList.map((s) => s.name),
    dbBackedPoolCount: dbPools.size,
    scannerPoolCount,
    totalPoolCount: dbPools.size + scannerPoolCount,
  };
}
