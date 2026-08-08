/**
 * End-to-end silo provisioning integration test (task 17.1).
 *
 * Validates: Requirements 3.3, 3.4, 3.6, 4.3
 *
 * Drives `provisionSiloDatabase` (services/install-service/src/modules/
 * provisioning/actuator.ts, task 7.5) against the real dev-stack Postgres
 * (`civitasone-postgres`, localhost:5435) using the privileged
 * `civitas_admin` runner identity (CREATEDB) — never `DATABASE_URL` for any
 * DB_Backed_Service, per the actuator's privilege boundary (Req 3.7).
 *
 * Scope: `listAllMigrations` walks the actuator's fixed `SERVICES` export (the
 * real 31 DB_Backed_Service names), so this test points `reposRoot` at a
 * fixture tree whose directory layout uses two of those real service names
 * (`install-service`, `tenant-service`) but supplies small, idempotent,
 * dependency-free fixture migration files in place of the real fleet's
 * migrations — enough to exercise the real directory-walk, apply-loop, and
 * resumability logic end-to-end without coupling this test's runtime to the
 * full fleet's actual migration set (which assumes sibling schemas/extensions
 * already exist).
 *
 * Proves:
 *   1. First run creates the tenant database and applies every migration.
 *   2. Re-running with the previous run's `appliedMigrations` (simulating a
 *      resume) applies zero new migrations and reports the same objects —
 *      no duplicates, no errors (Req 3.3, 3.6, 4.3).
 *   3. Re-running from a clean `alreadyApplied: []` (simulating retry of a
 *      `failed`/stale-`provisioning` record whose migrations already landed)
 *      is also a no-op thanks to each migration's own `IF NOT EXISTS` +
 *      the actuator's idempotent-error tolerance — zero duplicate objects.
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import postgres from "postgres";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { provisionSiloDatabase, SERVICES } from "../src/modules/provisioning/actuator.js";

// Prefer PROVISIONING_RUNNER_DSN (set by vitest.config from CI PGPASSWORD /
// POSTGRES_ADMIN_PASSWORD). Fall back builds the same way so a bare
// `vitest run` against CI's civitas_test password still authenticates.
const ADMIN_PW =
  process.env.POSTGRES_ADMIN_PASSWORD ?? process.env.PGPASSWORD ?? "civitas_dev_pw";
const RUNNER_DSN =
  process.env.PROVISIONING_RUNNER_DSN ??
  `postgres://civitas_admin:${encodeURIComponent(ADMIN_PW)}@${process.env.PGHOST ?? "localhost"}:${process.env.PGPORT ?? "5435"}/postgres`;

describe("provisionSiloDatabase — end-to-end (real Postgres)", () => {
  let fixtureRoot: string;
  let runnerConn: postgres.Sql;
  const dbName = `civitas_e2e_silo_${Date.now().toString(36)}`;

  // `listAllMigrations` walks the actuator's own fixed `SERVICES` list (Req
  // 3.8) by name — arbitrary directory names are silently skipped — so the
  // fixture tree must use two of those real service names as its directories.
  const FIXTURE_SERVICES = [SERVICES[0]!, SERVICES[1]!];

  beforeAll(() => {
    // Build a small fixture migration tree: two of the real DB_Backed_Service
    // names, one migration each, both additive/idempotent (mirrors the real
    // fleet's migration style) but schema-namespaced under a `probe_` prefix
    // so this test never collides with any other suite's schemas.
    fixtureRoot = mkdtempSync(join(tmpdir(), "silo-e2e-"));
    for (const svc of FIXTURE_SERVICES) {
      const dir = join(fixtureRoot, "services", svc, "migrations");
      mkdirSync(dir, { recursive: true });
      const schema = `probe_${svc.replace(/-/g, "_")}`;
      writeFileSync(
        join(dir, "0001_init.sql"),
        `CREATE SCHEMA IF NOT EXISTS ${schema};\n` +
          `CREATE TABLE IF NOT EXISTS ${schema}.probe (id uuid PRIMARY KEY, tenant_id uuid NOT NULL);\n`,
      );
    }
    runnerConn = postgres(RUNNER_DSN, { max: 1 });
  });

  afterAll(async () => {
    await runnerConn.unsafe(`DROP DATABASE IF EXISTS ${dbName}`).catch(() => undefined);
    await runnerConn.end({ timeout: 5 }).catch(() => undefined);
    rmSync(fixtureRoot, { recursive: true, force: true });
  });

  it("creates the tenant database and applies every fixture migration", async () => {
    const tenantId = "aaaaaaaa-e2e0-4000-8000-000000000001";
    const result = await provisionSiloDatabase(tenantId, dbName, [], runnerConn, { reposRoot: fixtureRoot });

    expect(result.status).toBe("ready");
    expect(result.appliedMigrations.sort()).toEqual(
      FIXTURE_SERVICES.map((svc) => `${svc}/0001_init.sql`).sort(),
    );
    // Every step (create_database + both migrations) succeeded.
    expect(result.steps.every((s) => s.ok)).toBe(true);

    // The tables genuinely exist in the newly created database.
    const schemas = FIXTURE_SERVICES.map((svc) => `probe_${svc.replace(/-/g, "_")}`);
    const tenantConn = postgres(dsnFor(RUNNER_DSN, dbName), { max: 1 });
    try {
      const rows = await tenantConn`
        SELECT table_schema, table_name FROM information_schema.tables
        WHERE table_schema = ANY(${schemas})
        ORDER BY table_schema
      `;
      expect(rows).toHaveLength(2);
      expect(rows.map((r) => r.table_schema).sort()).toEqual([...schemas].sort());
    } finally {
      await tenantConn.end({ timeout: 5 });
    }
  });

  it("re-running with the prior run's appliedMigrations (resume) applies zero new migrations and creates zero duplicate objects", async () => {
    const tenantId = "aaaaaaaa-e2e0-4000-8000-000000000001";
    const priorApplied = FIXTURE_SERVICES.map((svc) => `${svc}/0001_init.sql`);

    const result = await provisionSiloDatabase(tenantId, dbName, priorApplied, runnerConn, { reposRoot: fixtureRoot });

    expect(result.status).toBe("ready");
    // No NEW migrations applied beyond what was already recorded — the
    // returned appliedMigrations is exactly the input (nothing pending).
    expect(result.appliedMigrations.sort()).toEqual(priorApplied.sort());
    // Only the create_database step ran (already-exists path); no migration steps re-executed.
    expect(result.steps.map((s) => s.step)).toEqual(["create_database"]);

    const schemas = FIXTURE_SERVICES.map((svc) => `probe_${svc.replace(/-/g, "_")}`);
    const tenantConn = postgres(dsnFor(RUNNER_DSN, dbName), { max: 1 });
    try {
      const rows = await tenantConn`
        SELECT table_schema, count(*) AS cnt
        FROM information_schema.tables
        WHERE table_schema = ANY(${schemas})
        GROUP BY table_schema
      `;
      // Exactly one `probe` table per fixture schema — re-running never duplicated objects.
      expect(rows).toHaveLength(2);
      for (const r of rows) expect(Number(r.cnt)).toBe(1);
    } finally {
      await tenantConn.end({ timeout: 5 });
    }
  });

  it("re-running from a clean alreadyApplied=[] (retry-of-failed-record scenario) is a safe no-op thanks to IF NOT EXISTS + idempotent-error tolerance", async () => {
    const tenantId = "aaaaaaaa-e2e0-4000-8000-000000000001";

    // Simulates a stale/failed record being retried without its appliedMigrations
    // persisted (Req 4.3) — the actuator must still land on `ready` without
    // creating duplicate schema/table objects, since every migration statement
    // is itself idempotent and the actuator tolerates "already exists" errors.
    const result = await provisionSiloDatabase(tenantId, dbName, [], runnerConn, { reposRoot: fixtureRoot });

    expect(result.status).toBe("ready");
    expect(result.steps.every((s) => s.ok)).toBe(true);

    const schemas = FIXTURE_SERVICES.map((svc) => `probe_${svc.replace(/-/g, "_")}`);
    const tenantConn = postgres(dsnFor(RUNNER_DSN, dbName), { max: 1 });
    try {
      const rows = await tenantConn`
        SELECT table_schema, count(*) AS cnt
        FROM information_schema.tables
        WHERE table_schema = ANY(${schemas})
        GROUP BY table_schema
      `;
      expect(rows).toHaveLength(2);
      for (const r of rows) expect(Number(r.cnt)).toBe(1); // still exactly one — zero duplicates
    } finally {
      await tenantConn.end({ timeout: 5 });
    }
  });
});

/** Swap the DSN's database segment for `dbName`, preserving host/port/credentials. */
function dsnFor(dsn: string, dbName: string): string {
  const u = new URL(dsn);
  u.pathname = `/${dbName}`;
  return u.toString();
}
