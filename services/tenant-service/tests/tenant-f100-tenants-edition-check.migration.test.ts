/**
 * UAT F100: tenant.tenants.tenants_edition_check exists on live UAT only as NOT VALID (0014_additional_status_type_constraints.sql added it NOT VALID,
 * its VALIDATE failed on 1 bad row(s) and the tolerant deploy runner hid the error).
 * 0034_tenants_edition_check_validate.sql repairs exactly those values and validates the constraint.
 * The scratch test rebuilds that state (FORCE RLS, NOT VALID constraint, bad rows) in a
 * throwaway schema, runs the migration twice as the table owner and rolls back.
 */
import { describe, it, expect, afterAll } from "vitest";
import { randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import { sqlClient } from "../src/shared/db.js";

const MIGRATION = new URL("../migrations/0034_tenants_edition_check_validate.sql", import.meta.url);
const CHECK = "CHECK (edition IN ('govt', 'psu', 'private', 'ngo', 'section8', 'cooperative', 'small_office'))";
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
    CREATE TABLE ${scratch}.tenants (
      id uuid PRIMARY KEY, tenant_id uuid NOT NULL, edition varchar(32) NOT NULL,
      updated_at timestamptz NOT NULL DEFAULT now());
    ALTER TABLE ${scratch}.tenants ENABLE ROW LEVEL SECURITY;
    ALTER TABLE ${scratch}.tenants FORCE ROW LEVEL SECURITY;
    CREATE POLICY t ON ${scratch}.tenants
      USING (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid);`);
  await sql`select set_config('app.tenant_id', ${tenant}, true)`;
  for (const v of values) {
    await sql.unsafe(`INSERT INTO ${scratch}.tenants (id, tenant_id, edition) VALUES ('${randomUUID()}', '${tenant}', '${v}')`);
  }
  await sql.unsafe(`ALTER TABLE ${scratch}.tenants ADD CONSTRAINT tenants_edition_check ${check} NOT VALID`);
  await sql`select set_config('app.tenant_id', '', true)`;
}

async function migrationFor(scratch: string): Promise<string> {
  return (await readFile(MIGRATION, "utf8"))
    .replace(/^\s*(BEGIN|COMMIT);\s*$/gim, "")
    .replace(/\btenant\.(tenants)\b/g, `${scratch}.$1`);
}

describe("0034: repairs the UAT rows and validates tenants_edition_check", () => {
  it("maps govt_dept to govt, validates the constraint, keeps FORCE RLS, re-runs cleanly", async () => {
    const scratch = `f100_${randomUUID().replace(/-/g, "").slice(0, 12)}`;
    const tenant = randomUUID();
    const sqlText = await migrationFor(scratch);
    await inRolledBackTx(async (sql) => {
      await scratchState(sql, scratch, tenant, CHECK, ["govt_dept", "psu"]);
      await sql.unsafe(sqlText);
      await sql.unsafe(sqlText);

      const con = await sql<{ convalidated: boolean; force: boolean }[]>`
        SELECT c.convalidated, t.relforcerowsecurity AS force
          FROM pg_constraint c JOIN pg_class t ON t.oid = c.conrelid
         WHERE t.relnamespace = ${scratch}::regnamespace AND c.conname = 'tenants_edition_check'`;
      expect(con).toEqual([{ convalidated: true, force: true }]);

      await sql`select set_config('app.tenant_id', ${tenant}, true)`;
      const rows = await sql.unsafe<{ v: string }[]>(`SELECT edition AS v FROM ${scratch}.tenants ORDER BY edition`);
      expect(rows.map((r) => r.v)).toEqual(["govt", "psu"]);
    });
  });

  it("refuses a same-named constraint with a different definition instead of trusting the name", async () => {
    const scratch = `f100_${randomUUID().replace(/-/g, "").slice(0, 12)}`;
    const sqlText = await migrationFor(scratch);
    await inRolledBackTx(async (sql) => {
      await scratchState(sql, scratch, randomUUID(), "CHECK (edition IS NOT NULL)", []);
      await expect(sql.unsafe(sqlText)).rejects.toThrow(/tenants_edition_check exists with a different definition/);
    });
  });

  it("the migrated tenant schema has tenants_edition_check validated", async () => {
    const con = await sqlClient<{ convalidated: boolean }[]>`
      SELECT convalidated FROM pg_constraint WHERE conrelid = 'tenant.tenants'::regclass AND conname = 'tenants_edition_check'`;
    expect(con).toEqual([{ convalidated: true }]);
  });
});
