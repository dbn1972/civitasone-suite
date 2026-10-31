/**
 * UAT F100: reports.jobs.jobs_status_check exists on live UAT only as NOT VALID (0008_check_constraints_status_columns.sql added it NOT VALID,
 * its VALIDATE failed on 3 bad row(s) and the tolerant deploy runner hid the error).
 * 0021_jobs_status_check_validate.sql repairs exactly those values and validates the constraint.
 * The scratch test rebuilds that state (FORCE RLS, NOT VALID constraint, bad rows) in a
 * throwaway schema, runs the migration twice as the table owner and rolls back.
 */
import { describe, it, expect, afterAll } from "vitest";
import { randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import { sqlClient } from "../src/shared/db.js";

const MIGRATION = new URL("../migrations/0021_jobs_status_check_validate.sql", import.meta.url);
const CHECK = "CHECK (status IN ('queued', 'processing', 'completed', 'failed'))";
const ROLLBACK = new Error("rollback");

afterAll(async () => {
  await sqlClient.end();
});

async function inRolledBackTx(fn: (sql: typeof sqlClient) => Promise<void>): Promise<void> {
  await sqlClient
    .begin(async (sql) => {
      await fn(sql as unknown as typeof sqlClient);
      throw ROLLBACK;
    })
    .catch((e) => {
      if (e !== ROLLBACK) throw e;
    });
}

async function scratchState(sql: typeof sqlClient, scratch: string, tenant: string, check: string, values: string[]) {
  await sql.unsafe(`
    CREATE SCHEMA ${scratch};
    CREATE TABLE ${scratch}.jobs (
      id uuid PRIMARY KEY, tenant_id uuid NOT NULL, status varchar(32) NOT NULL,
      updated_at timestamptz NOT NULL DEFAULT now());
    ALTER TABLE ${scratch}.jobs ENABLE ROW LEVEL SECURITY;
    ALTER TABLE ${scratch}.jobs FORCE ROW LEVEL SECURITY;
    CREATE POLICY t ON ${scratch}.jobs
      USING (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid);`);
  await sql`select set_config('app.tenant_id', ${tenant}, true)`;
  for (const v of values) {
    await sql.unsafe(`INSERT INTO ${scratch}.jobs (id, tenant_id, status) VALUES ('${randomUUID()}', '${tenant}', '${v}')`);
  }
  await sql.unsafe(`ALTER TABLE ${scratch}.jobs ADD CONSTRAINT jobs_status_check ${check} NOT VALID`);
  await sql`select set_config('app.tenant_id', '', true)`;
}

async function migrationFor(scratch: string): Promise<string> {
  return (await readFile(MIGRATION, "utf8"))
    .replace(/^\s*(BEGIN|COMMIT);\s*$/gim, "")
    .replace(/\breports\.(jobs)\b/g, `${scratch}.$1`);
}

describe("0021: repairs the UAT rows and validates jobs_status_check", () => {
  it("maps pending/active to queued, validates the constraint, keeps FORCE RLS, re-runs cleanly", async () => {
    const scratch = `f100_${randomUUID().replace(/-/g, "").slice(0, 12)}`;
    const tenant = randomUUID();
    const sqlText = await migrationFor(scratch);
    await inRolledBackTx(async (sql) => {
      await scratchState(sql, scratch, tenant, CHECK, ["pending", "active", "active", "completed"]);
      await sql.unsafe(sqlText);
      await sql.unsafe(sqlText);

      const con = await sql<{ convalidated: boolean; force: boolean }[]>`
        SELECT c.convalidated, t.relforcerowsecurity AS force
          FROM pg_constraint c JOIN pg_class t ON t.oid = c.conrelid
         WHERE t.relnamespace = ${scratch}::regnamespace AND c.conname = 'jobs_status_check'`;
      expect(con).toEqual([{ convalidated: true, force: true }]);

      await sql`select set_config('app.tenant_id', ${tenant}, true)`;
      const rows = await sql.unsafe<{ v: string }[]>(`SELECT status AS v FROM ${scratch}.jobs ORDER BY status`);
      expect(rows.map((r) => r.v)).toEqual(["completed", "queued", "queued", "queued"]);
    });
  });

  it("refuses a same-named constraint with a different definition instead of trusting the name", async () => {
    const scratch = `f100_${randomUUID().replace(/-/g, "").slice(0, 12)}`;
    const sqlText = await migrationFor(scratch);
    await inRolledBackTx(async (sql) => {
      await scratchState(sql, scratch, randomUUID(), "CHECK (status IS NOT NULL)", []);
      await expect(sql.unsafe(sqlText)).rejects.toThrow(/jobs_status_check exists with a different definition/);
    });
  });

  it("the migrated reports schema has jobs_status_check validated", async () => {
    const con = await sqlClient<{ convalidated: boolean }[]>`
      SELECT convalidated FROM pg_constraint WHERE conrelid = 'reports.jobs'::regclass AND conname = 'jobs_status_check'`;
    expect(con).toEqual([{ convalidated: true }]);
  });
});
