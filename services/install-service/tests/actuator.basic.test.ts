/**
 * Minimal coverage tests for the Provisioning_Actuator (task 7.5).
 *
 * These are deliberately lightweight — they exercise `provisionSiloDatabase`
 * against a fake `postgres.Sql`-shaped runner (no real Postgres connection),
 * covering: database-already-exists vs newly-created, applying pending
 * migrations from a fixture migration tree, idempotent "already exists"
 * errors, a hard failure short-circuiting the walk, and `listAllMigrations`'
 * fixture-root behavior. Detailed integration coverage against a real
 * Postgres instance is out of scope for this task (see task 17.1's planned
 * end-to-end silo provisioning integration test).
 */
import { describe, it, expect, vi } from "vitest";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

// `provisionSiloDatabase` opens a SECOND privileged connection to the tenant's
// dedicated database (`connectToDatabase`) via a bare `postgres(...)` call —
// distinct from the injected `runnerConn` fake used for the maintenance-DB
// steps. Mock the `postgres` default export so that second connection is also
// a fake (no real network I/O), routing through the same `onUnsafe` handler
// configured by each fake `runnerConn` below.
let activeTenantHandler: ((sql: string, params?: unknown[]) => unknown) | undefined;
vi.mock("postgres", () => {
  const factory = vi.fn(() => {
    const fn = vi.fn(async (sql: string, params?: unknown[]) => {
      if (!activeTenantHandler) return [];
      return activeTenantHandler(sql, params);
    });
    const sqlFn = ((...args: unknown[]) => fn(...(args as [string, unknown[]?]))) as unknown as {
      unsafe: typeof fn;
      end: () => Promise<void>;
    };
    sqlFn.unsafe = fn;
    sqlFn.end = vi.fn(async () => undefined);
    return sqlFn;
  });
  return { default: factory };
});

const { provisionSiloDatabase, listAllMigrations, SERVICES } = await import(
  "../src/modules/provisioning/actuator.js"
);

/** Build a fixture repo root with migrations for a couple of the known SERVICES. */
function makeFixtureRoot(): string {
  const root = mkdtempSync(join(tmpdir(), "actuator-fixture-"));
  const svc1 = SERVICES[0]!;
  const svc2 = SERVICES[1]!;
  const dir1 = join(root, "services", svc1, "migrations");
  const dir2 = join(root, "services", svc2, "migrations");
  mkdirSync(dir1, { recursive: true });
  mkdirSync(dir2, { recursive: true });
  writeFileSync(join(dir1, "0001_init.sql"), "CREATE TABLE IF NOT EXISTS t1 (id int);");
  writeFileSync(join(dir2, "0001_init.sql"), "CREATE TABLE IF NOT EXISTS t2 (id int);");
  return root;
}

/**
 * A minimal fake postgres.Sql-shaped client sufficient for provisionSiloDatabase's
 * maintenance-connection usage (database-existence check / CREATE DATABASE).
 * `onTenantUnsafe`, if supplied, becomes the handler for the SEPARATE mocked
 * tenant-database connection that `provisionSiloDatabase` opens internally via
 * the mocked `postgres` module (see `connectToDatabase` in actuator.ts) — this
 * is what migration-application steps actually run against.
 */
function makeFakeSql(opts: {
  dbExists?: boolean;
  onTenantUnsafe?: (sql: string, params?: unknown[]) => unknown;
} = {}) {
  const calls: string[] = [];
  const fn = vi.fn(async (sql: string, params?: unknown[]) => {
    calls.push(sql);
    if (sql.includes("SELECT 1 FROM pg_database")) {
      return opts.dbExists ? [{ x: 1 }] : [];
    }
    return [];
  });
  const sql = {
    unsafe: fn,
    options: { host: ["localhost"], port: [5432], user: "civitas_admin", pass: "secret", ssl: false },
    end: vi.fn(async () => undefined),
  } as unknown as import("postgres").Sql;
  activeTenantHandler = opts.onTenantUnsafe;
  return { sql, calls };
}

describe("listAllMigrations", () => {
  it("discovers migration files for known services under a fixture root", () => {
    const root = makeFixtureRoot();
    try {
      const steps = listAllMigrations(root);
      expect(steps.length).toBe(2);
      expect(steps.map((s) => s.file)).toEqual(["0001_init.sql", "0001_init.sql"]);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("skips services with no migrations directory", () => {
    const root = mkdtempSync(join(tmpdir(), "actuator-empty-"));
    try {
      expect(listAllMigrations(root)).toEqual([]);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});

describe("provisionSiloDatabase", () => {
  it("creates the database when it does not exist and applies all pending migrations", async () => {
    const root = makeFixtureRoot();
    try {
      const { sql } = makeFakeSql({ dbExists: false });
      const result = await provisionSiloDatabase("11111111-1111-1111-1111-111111111111", "civitas_tenant_x", [], sql, {
        reposRoot: root,
      });
      expect(result.status).toBe("ready");
      expect(result.appliedMigrations.length).toBe(2);
      expect(result.steps.find((s) => s.step === "create_database")?.detail).toContain("created");
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("treats an already-existing database as idempotent, not an error", async () => {
    const root = makeFixtureRoot();
    try {
      const { sql } = makeFakeSql({ dbExists: true });
      const result = await provisionSiloDatabase("11111111-1111-1111-1111-111111111111", "civitas_tenant_x", [], sql, {
        reposRoot: root,
      });
      expect(result.status).toBe("ready");
      expect(result.steps.find((s) => s.step === "create_database")?.detail).toContain("already exists");
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("only applies migrations not already in alreadyApplied (resumable diff)", async () => {
    const root = makeFixtureRoot();
    try {
      const svc1 = SERVICES[0]!;
      const { sql } = makeFakeSql({ dbExists: true });
      const alreadyApplied = [`${svc1}/0001_init.sql`];
      const result = await provisionSiloDatabase(
        "11111111-1111-1111-1111-111111111111",
        "civitas_tenant_x",
        alreadyApplied,
        sql,
        { reposRoot: root },
      );
      expect(result.status).toBe("ready");
      // 1 already applied + 1 newly applied = 2 total; only 1 new step recorded.
      expect(result.appliedMigrations.length).toBe(2);
      expect(result.steps.filter((s) => s.ok && s.step !== "create_database").length).toBe(1);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("treats an 'already exists' migration error as idempotent and continues", async () => {
    const root = makeFixtureRoot();
    try {
      const { sql } = makeFakeSql({
        dbExists: true,
        onTenantUnsafe: () => {
          throw new Error('relation "t1" already exists');
        },
      });
      const result = await provisionSiloDatabase("11111111-1111-1111-1111-111111111111", "civitas_tenant_x", [], sql, {
        reposRoot: root,
      });
      expect(result.status).toBe("ready");
      expect(result.steps.some((s) => s.detail === "already applied (idempotent)")).toBe(true);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("stops and reports failure on a hard migration error", async () => {
    const root = makeFixtureRoot();
    try {
      const { sql } = makeFakeSql({
        dbExists: true,
        onTenantUnsafe: () => {
          throw new Error("ERROR: syntax error at or near \"CREATE\"");
        },
      });
      const result = await provisionSiloDatabase("11111111-1111-1111-1111-111111111111", "civitas_tenant_x", [], sql, {
        reposRoot: root,
      });
      expect(result.status).toBe("failed");
      expect(result.failingStep).toBeDefined();
      expect(result.error).toContain("syntax error");
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("reports a failed status when database creation itself throws", async () => {
    const root = makeFixtureRoot();
    try {
      const { sql } = makeFakeSql({ dbExists: false });
      // Override the maintenance-connection handler to throw on CREATE DATABASE.
      (sql.unsafe as ReturnType<typeof vi.fn>).mockImplementation(async (sqlText: string) => {
        if (sqlText.includes("SELECT 1 FROM pg_database")) return [];
        throw new Error("permission denied to create database");
      });
      const result = await provisionSiloDatabase("11111111-1111-1111-1111-111111111111", "civitas_tenant_x", [], sql, {
        reposRoot: root,
      });
      expect(result.status).toBe("failed");
      expect(result.failingStep).toBe("create_database");
      expect(result.error).toContain("permission denied");
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});
