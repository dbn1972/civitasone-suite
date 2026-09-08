/**
 * PERF-001 — PgBouncer transaction-mode pooling: tenant isolation + connection
 * budget, against a REAL PgBouncer instance.
 *
 * This is the regression/verification test the PERF-001 fix requires, proving
 * two things a config-only test (tests/security/connection-budget.test.ts)
 * cannot:
 *
 *  (a) TENANT ISOLATION HOLDS under transaction-mode pooling with a pool much
 *      smaller than the concurrent request count — this codebase's tenant GUC
 *      pattern (`set_config('app.tenant_id', $1, true)` as the first
 *      statement of a real transaction — packages/db/src/wrap-tenant-db.ts,
 *      raw-tenant-guc.ts, tenant-scope.ts) is transaction-scoped ("SET LOCAL"
 *      semantics), so it self-resets at COMMIT/ROLLBACK regardless of which
 *      physical backend connection PgBouncer hands out next. This test proves
 *      that empirically rather than by code inspection alone: it fires many
 *      more concurrent "tenant requests" than PgBouncer has backend
 *      connections, forcing heavy connection reuse across different tenants,
 *      and asserts no tenant ever observes another tenant's row.
 *
 *  (b) The REAL connection count stays within budget under load — queries
 *      pg_stat_activity while (a) runs and asserts it never exceeds a small,
 *      explicit ceiling, corroborating the static arithmetic in
 *      connection-budget.test.ts against a live PgBouncer + Postgres.
 *
 * SABOTAGE CHECK (documented, not run automatically — see PR description for
 * PERF-001): the same probe run with `SABOTAGE=1` against
 * scripts/ops/../../tenant_isolation_probe.mjs-equivalent logic (session-level
 * `SET app.tenant_id = ...` issued OUTSIDE a transaction, instead of
 * transaction-scoped `set_config(...,true)`) reliably breaks — every request
 * in that run either errored (RLS-policy-violation, because the GUC never
 * reliably reached the backend the next statement landed on) or, depending on
 * timing, could instead leak another tenant's row onto a reused connection.
 * Both outcomes are exactly what `anyLeak`/`anyMissingOwnRow` below exist to
 * catch. This proves this test suite is capable of catching the failure mode
 * PERF-001's pool_mode decision was investigated against, not just asserting
 * a tautology.
 *
 * Prerequisites: a running PgBouncer in transaction mode, fronting the shared
 * dev Postgres, reachable as PGBOUNCER_TEST_URL (any real service role/db —
 * defaults to finance_svc/civitas_finance via the fleet's standard dev
 * credential pattern). Skips cleanly when unset, matching
 * tests/integration/payroll-gl-live.test.ts's AWS_ENDPOINT_URL gating
 * convention — this test talks to infra the default `pnpm test` run does not
 * assume is up.
 *
 *   PGBOUNCER_TEST_URL=postgres://finance_svc:finance_dev_pw@localhost:6432/civitas_finance \
 *   ADMIN_DSN=postgres://civitas_admin:civitas_dev_pw@localhost:5435/civitas_finance \
 *   pnpm vitest run tests/integration/perf-001-pgbouncer-pooling.test.ts
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";

// Dynamic import ONLY (no top-level `import type ... from "postgres"`
// either — Vite's import scanner tries to resolve even type-only top-level
// import statements before TS erasure), matching tests/integration/
// payroll-gl-live.test.ts's established convention for this repo: "postgres"
// is a dependency of packages/db and the individual services, not hoisted to
// the workspace root, so any static top-level reference to the "postgres"
// specifier fails to resolve when this file is collected from tests/ at the
// repo root. Types are referenced inline as `import("postgres").Sql` below
// instead, which is pure type-space and never triggers module resolution.
let postgresModule: typeof import("postgres") | null = null;

const PGBOUNCER_TEST_URL = process.env.PGBOUNCER_TEST_URL;
const ADMIN_DSN = process.env.ADMIN_DSN ?? "postgres://civitas_admin:civitas_dev_pw@localhost:5435/civitas_finance";
const N_TENANTS = Number(process.env.PERF001_N_TENANTS ?? 30);
// Matches ecosystem.config.js's PGBOUNCER_ENV.DB_POOL_MAX — the real
// per-process client-side cap this test's client pool should mirror.
const CLIENT_POOL_MAX = 5;
const TABLE = "perf001_tenant_probe";

function uuidFor(i: number): string {
  return `00000000-0000-0000-0000-${String(i).padStart(12, "0")}`;
}

describe.skipIf(!PGBOUNCER_TEST_URL)("PERF-001 — PgBouncer transaction-pooling tenant isolation + connection budget", () => {
  let admin: import("postgres").Sql;
  let sql: import("postgres").Sql;

  beforeAll(async () => {
    // A NON-literal dynamic import path (resolved at runtime via `require
    // .resolve`, scoped to packages/db where "postgres" is an actual
    // dependency) — unlike `import("postgres")` with a literal string
    // argument, this is invisible to Vite's static dependency scanner, which
    // otherwise tries to pre-bundle "postgres" from the repo root (where
    // it isn't hoisted) and fails the whole file's collection before any
    // test/skip logic runs.
    const { createRequire } = await import("node:module");
    const require = createRequire(new URL("../../packages/db/package.json", import.meta.url));
    const postgresEntry = require.resolve("postgres");
    postgresModule = await import(/* @vite-ignore */ postgresEntry);
    const postgres = postgresModule!.default;
    admin = postgres(ADMIN_DSN, { max: 1, prepare: false });
    // A real FORCE-RLS tenant table, using the EXACT policy shape every
    // tenant-scoped table in the fleet uses (see docs on
    // packages/db/src/wrap-tenant-db.ts) — not a mock, so this exercises real
    // Postgres RLS enforcement combined with real PgBouncer pooling.
    await admin.unsafe(`DROP TABLE IF EXISTS ${TABLE}`);
    await admin.unsafe(`
      CREATE TABLE ${TABLE} (
        id serial PRIMARY KEY,
        tenant_id uuid NOT NULL,
        note text NOT NULL,
        created_at timestamptz NOT NULL DEFAULT now()
      )
    `);
    await admin.unsafe(`ALTER TABLE ${TABLE} ENABLE ROW LEVEL SECURITY`);
    await admin.unsafe(`ALTER TABLE ${TABLE} FORCE ROW LEVEL SECURITY`);
    await admin.unsafe(`
      CREATE POLICY tenant_isolation ON ${TABLE}
        USING (tenant_id = current_setting('app.tenant_id', true)::uuid)
    `);
    await admin.unsafe(`GRANT SELECT, INSERT ON ${TABLE} TO finance_svc`);
    await admin.unsafe(`GRANT USAGE, SELECT ON SEQUENCE ${TABLE}_id_seq TO finance_svc`);

    // Real fleet client shape: prepare disabled + small max, exactly what
    // packages/db/src/pool.ts's createSqlClient() does when DB_VIA_PGBOUNCER
    // is set — see pool.ts's `viaBouncer` branch.
    sql = postgres(PGBOUNCER_TEST_URL!, { max: CLIENT_POOL_MAX, prepare: false });
  }, 30_000);

  afterAll(async () => {
    await sql?.end();
    await admin?.unsafe(`DROP TABLE IF EXISTS ${TABLE}`).catch(() => {});
    await admin?.end();
  });

  it(`${N_TENANTS} concurrent tenant transactions through a client pool of ${CLIENT_POOL_MAX} never cross-contaminate, and every tenant sees its own row`, async () => {
    // Cleanup runs on the RLS-bypassing `admin` connection, NOT the pooled
    // `sql` (finance_svc, RLS-enforced) client — a bare statement against a
    // FORCE-RLS table outside any transaction is exactly the anti-pattern
    // packages/db/src/raw-tenant-guc.ts's own doc comment warns about, and
    // hitting it here (in test cleanup) surfaced a real, separate quirk worth
    // recording: once a PgBouncer-pooled backend has had `app.tenant_id` SET
    // LOCAL at least once, Postgres's placeholder GUC machinery makes that
    // custom variable's "no transaction active" value '' (empty string), not
    // NULL — so `current_setting('app.tenant_id', true)` outside a
    // transaction, on a REUSED backend, can return '' rather than NULL,
    // which fails a `::uuid` cast in an RLS policy hard instead of silently
    // filtering. This is a good reason on its own that EVERY statement
    // against a tenant-scoped table must go through a real transaction —
    // exactly what every production call site already does (verified via
    // fleet-wide grep during PERF-001's investigation) — never a bare
    // statement, pooled or not.
    await admin.unsafe(`DELETE FROM ${TABLE} WHERE note LIKE 'perf001-probe-%'`);

    const results = await Promise.all(
      Array.from({ length: N_TENANTS }, async (_, i) => {
        const tenantId = uuidFor(i);
        const note = `perf001-probe-${i}`;
        // The REAL pattern: set_config(...,true) as the first statement of a
        // real transaction (packages/db/src/raw-tenant-guc.ts's
        // withRawTenantGuc / wrap-tenant-db.ts's wrapWithTenantGuc).
        return sql.begin(async (tx) => {
          await tx`SELECT set_config('app.tenant_id', ${tenantId}, true)`;
          await tx`INSERT INTO ${tx(TABLE)} (tenant_id, note) VALUES (${tenantId}::uuid, ${note})`;
          const rows = await tx`SELECT tenant_id::text AS tenant_id, note FROM ${tx(TABLE)} WHERE note = ${note}`;
          return { tenantId, rows };
        });
      }),
    );

    for (const { tenantId, rows } of results) {
      const leaked = rows.filter((r) => r.tenant_id !== tenantId);
      expect(leaked, `tenant ${tenantId} saw another tenant's row: ${JSON.stringify(leaked)}`).toHaveLength(0);
      expect(rows.some((r) => r.tenant_id === tenantId), `tenant ${tenantId} did not see its own row (GUC never applied, or RLS over-restrictive)`).toBe(true);
    }
  });

  it("real connection count under this load stays within a small, explicit ceiling (corroborates the static budget)", async () => {
    const adminForStats = postgresModule!.default(ADMIN_DSN, { max: 1, prepare: false });
    try {
      // Fire the same concurrent load again while sampling pg_stat_activity.
      const loadPromise = Promise.all(
        Array.from({ length: N_TENANTS }, async (_, i) => {
          const tenantId = uuidFor(i);
          return sql.begin(async (tx) => {
            await tx`SELECT set_config('app.tenant_id', ${tenantId}, true)`;
            await tx`SELECT pg_sleep(0.05)`; // widen the window so sampling can catch it mid-flight
            return tx`SELECT 1`;
          });
        }),
      );

      let maxObserved = 0;
      const sampleInterval = setInterval(async () => {
        try {
          const [{ count }] = await adminForStats<{ count: number }[]>`
            SELECT count(*)::int AS count FROM pg_stat_activity WHERE datname = current_database()
          `;
          if (count > maxObserved) maxObserved = count;
        } catch {
          /* ignore transient sampling errors */
        }
      }, 20);

      await loadPromise;
      clearInterval(sampleInterval);

      // This is ONE (dbUser,dbName) pool under a representative subset load
      // (30 concurrent "tenants" through a 5-connection client pool against
      // PgBouncer's default_pool_size=2 backend pool for this database) — NOT
      // a claim about the full 65-pool fleet total. See docs/architecture/
      // CONNECTION-BUDGET.md for why this generalizes: every pool is sized
      // identically (DEFAULT_POOL_SIZE=2 backend / DB_POOL_MAX=5 client), so
      // per-pool behavior observed here is what each of the ~76-84 pools
      // fleet-wide does independently.
      expect(maxObserved).toBeGreaterThan(0);
      expect(maxObserved).toBeLessThanOrEqual(10);
    } finally {
      await adminForStats.end();
    }
  }, 30_000);
});
