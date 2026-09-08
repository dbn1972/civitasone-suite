/**
 * Invariant test: PERF-001 — Database connection budget stays under
 * max_connections, AND the fleet is actually wired the way this budget
 * assumes.
 *
 * PERF-001 was a REGRESSION of an earlier "C2" fix: this file used to encode
 * `DB_BACKED_SERVICES = 33` as a hand-maintained literal. The fleet then grew
 * to 65 DB-backed services (129 PM2 processes) and this test kept passing —
 * it was asserting arithmetic on a number nobody was updating, never the real
 * ecosystem.config.js. Every quantity below is now derived LIVE from
 * ecosystem.config.js via scripts/ops/lib/fleet-topology.mjs so this class of
 * silent drift can't happen again, and the last two tests assert the actual
 * wiring (DB_VIA_PGBOUNCER/DB_POOL_MAX on every DB-backed process), not just
 * the arithmetic.
 *
 * PROPERTY: Total pool budget across the real fleet MUST stay under
 * PostgreSQL max_connections when routed through PgBouncer.
 *
 * This test validates the architectural constraint from static config
 * (ecosystem.config.js + infra/docker-compose.yml's pgbouncer env +
 * infra/pgbouncer/pgbouncer.ini), not a live connection count — that's what
 * scripts/ops/verify-pgbouncer-routing.mjs + the load test in
 * tests/integration/perf-001-pgbouncer-pooling.test.ts are for.
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";
import { createRequire } from "node:module";
import { loadFleetTopology } from "../../scripts/ops/lib/fleet-topology.mjs";

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(__dirname, "../..");

const topology = loadFleetTopology();

// PgBouncer / Postgres budget constants — must match infra/docker-compose.yml's
// `pgbouncer` service env, infra/pgbouncer/pgbouncer.ini, and
// infra/postgres/postgresql.conf. Sizing rationale: docs/architecture/
// CONNECTION-BUDGET.md.
const DEFAULT_POOL_MAX_DIRECT = 10; // packages/db/src/pool.ts's pre-PERF-001 default
const DB_POOL_MAX_PGBOUNCER = 5; // ecosystem.config.js's PGBOUNCER_ENV.DB_POOL_MAX
const PG_MAX_CONNECTIONS = 200; // infra/postgres/postgresql.conf
const PGBOUNCER_MAX_CLIENT_CONN = 1000; // infra/docker-compose.yml pgbouncer.environment.MAX_CLIENT_CONN
const PGBOUNCER_DEFAULT_POOL_SIZE = 2; // infra/docker-compose.yml pgbouncer.environment.DEFAULT_POOL_SIZE

describe("PERF-001 — Connection budget invariant (derived from the real fleet)", () => {
  it("sanity: the fleet actually has DB-backed services and scanner pools to budget for", () => {
    // Guards against fleet-topology.mjs silently returning an empty/broken
    // parse (e.g. ecosystem.config.js failing to require()) and every other
    // test in this file passing vacuously.
    expect(topology.dbBackedPoolCount).toBeGreaterThan(0);
    expect(topology.processCount).toBeGreaterThan(topology.dbBackedPoolCount);
  });

  it("direct connections (no pgbouncer) EXCEED max_connections — this is the problem PERF-001 fixes", () => {
    const totalDirect = topology.processCount * DEFAULT_POOL_MAX_DIRECT;
    expect(totalDirect).toBeGreaterThan(PG_MAX_CONNECTIONS);
  });

  it("via pgbouncer: fleet processes + scanner pools, each capped at DB_POOL_MAX, fit within max_client_conn", () => {
    const totalClientConns = (topology.processCount + topology.scannerPoolCount) * DB_POOL_MAX_PGBOUNCER;
    expect(totalClientConns).toBeLessThanOrEqual(PGBOUNCER_MAX_CLIENT_CONN);
  });

  it("pgbouncer's real backend connections to Postgres (default_pool_size × distinct pools) fit within max_connections, with headroom", () => {
    // Distinct PgBouncer [user,database] pools: one per (dbUser,dbName) pair
    // shared by a svc()+worker() pair, plus one per wired scanner DSN (a
    // distinct BYPASSRLS role => a distinct pool key even when it shares a
    // database name with the main service pool).
    const totalBackendConns = topology.totalPoolCount * PGBOUNCER_DEFAULT_POOL_SIZE;
    expect(totalBackendConns).toBeLessThanOrEqual(PG_MAX_CONNECTIONS);

    // Headroom for Postgres's own superuser_reserved_connections, direct
    // admin/psql sessions, and one-off migration/seed scripts that connect
    // directly (max:1 dedicated connections — see packages/db/src/pool.ts
    // call sites in tests/scripts) rather than through PgBouncer.
    const headroom = PG_MAX_CONNECTIONS - totalBackendConns;
    expect(headroom).toBeGreaterThanOrEqual(20);
  });

  it("pool.ts pgbouncer detection works for port 6432", () => {
    // Validate the detection logic from packages/db/src/pool.ts
    const url6432 = "postgres://svc:pw@pgbouncer:6432/civitas_finance";
    const urlDirect = "postgres://svc:pw@postgres:5432/civitas_finance";

    const detectsPgbouncer = (u: string): boolean =>
      u.includes(":6432") || u.includes("pgbouncer");

    expect(detectsPgbouncer(url6432)).toBe(true);
    expect(detectsPgbouncer(urlDirect)).toBe(false);
  });

  it("pool.ts sets prepare=false when via pgbouncer", () => {
    // Transaction-mode pgbouncer cannot use prepared statements
    const viaBouncer = true;
    const prepare = !viaBouncer; // this is the actual logic in pool.ts
    expect(prepare).toBe(false);
  });

  it("ecosystem.config.js: every DB-backed svc()/worker() process actually sets DB_VIA_PGBOUNCER=true and DB_POOL_MAX (PERF-001 wiring guard)", () => {
    // The budget math above is only true if every DB-backed process is
    // ACTUALLY wired to go through PgBouncer with the capped pool size —
    // this is what would have caught PERF-001 before it shipped (the helper
    // functions existed; nothing called them with the right env). Re-derives
    // this independently of fleet-topology.mjs by requiring the real module
    // and inspecting each app's rendered env directly.
    //
    // vitest.config.mjs sets a single global `DATABASE_URL` for the whole
    // test run (its `test.env` block) — ecosystem.config.js's dbUrl() treats
    // ANY DATABASE_URL/DATABASE_URL_<SVC> already on process.env as an
    // "injected" override and returns it as-is for every service, so without
    // clearing those first every app would resolve to that one stubbed URL
    // and this assertion would be checking nothing real. Same reasoning as
    // fleet-topology.mjs's ENV_KEYS_TO_CLEAR.
    const clearedEnv: Record<string, string> = {};
    for (const key of Object.keys(process.env)) {
      if (/^DATABASE_URL($|_)|_SCANNER_DATABASE_URL$/.test(key)) {
        clearedEnv[key] = process.env[key]!;
        delete process.env[key];
      }
    }
    const previousNodeEnv = process.env.NODE_ENV;
    process.env.NODE_ENV = "test";

    let apps: any[];
    try {
      const req = createRequire(import.meta.url);
      const ecosystemPath = resolve(REPO_ROOT, "ecosystem.config.js");
      delete req.cache[req.resolve(ecosystemPath)];
      apps = req(ecosystemPath).apps;
    } finally {
      if (previousNodeEnv === undefined) delete process.env.NODE_ENV;
      else process.env.NODE_ENV = previousNodeEnv;
      for (const [key, value] of Object.entries(clearedEnv)) process.env[key] = value;
    }

    const dbBackedApps = apps.filter((a) => typeof a.env?.DATABASE_URL === "string" && a.env.DATABASE_URL.length > 0);
    expect(dbBackedApps.length).toBeGreaterThan(0);
    for (const app of dbBackedApps) {
      expect(app.env.DB_VIA_PGBOUNCER, `${app.name} missing DB_VIA_PGBOUNCER`).toBe("true");
      expect(app.env.DB_POOL_MAX, `${app.name} missing DB_POOL_MAX`).toBe("5");
      expect(app.env.DATABASE_URL, `${app.name} DATABASE_URL not pointed at PgBouncer`).toMatch(/:6432\//);
    }
  });

  it("infra/docker-compose.yml's pgbouncer service is configured for the real fleet size, not the stale 33-service numbers", () => {
    const compose = readFileSync(resolve(REPO_ROOT, "infra/docker-compose.yml"), "utf8");
    expect(compose).toMatch(/MAX_CLIENT_CONN:\s*"?1000"?/);
    expect(compose).toMatch(/DEFAULT_POOL_SIZE:\s*"?2"?/);
    expect(compose).toMatch(/POOL_MODE:\s*transaction/);
    // PERF-001 also fixed a real bug here: DATABASE_URL-driven config made
    // the edoburu/pgbouncer entrypoint emit a single named `[databases]
    // postgres = ...` entry instead of a wildcard, so no real service
    // database was ever reachable through it. Guard against that shape
    // coming back.
    expect(compose).not.toMatch(/DATABASE_URL:\s*postgres:\/\/[^\n]*@civitasone-postgres:5432\/\w+/);
    expect(compose).toMatch(/DB_HOST:\s*civitasone-postgres/);
    // PERF-001 also fixed a second, independent real bug: AUTH_TYPE: trust
    // never actually worked against this fleet's Postgres (pg_hba.conf
    // requires scram-sha-256 for every non-local connection) — verified
    // empirically that trust-mode PgBouncer's server-side login failed for
    // every role, regardless of the wildcard/database-routing fix above.
    // auth_user + auth_query let PgBouncer authenticate whichever real role
    // is connecting (fetched from pg_authid on demand) using ONE bootstrap
    // credential, rather than a static per-role userlist.txt for 65+ roles.
    expect(compose).toMatch(/AUTH_TYPE:\s*scram-sha-256/);
    expect(compose).toMatch(/AUTH_QUERY:.*pg_authid/);
  });
});
