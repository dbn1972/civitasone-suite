/**
 * UAT F100: jurisdiction.jurisdictions.jurisdictions_level_check exists on live UAT only as
 * NOT VALID (0010_additional_status_type_constraints.sql added it NOT VALID, its VALIDATE
 * failed on 4 rows and the tolerant deploy runner hid the error). Those rows are real
 * revenue-hierarchy levels (tehsil, subdivision) written by the pilot organogram seed, so
 * 0028_jurisdictions_level_check_validate.sql widens the CHECK to allow them and validates it.
 * The scratch test rebuilds that state (FORCE RLS, NOT VALID constraint, bad rows) in a
 * throwaway schema, runs the migration twice as the table owner and rolls back.
 */
import { describe, it, expect, afterAll } from "vitest";
import { randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import { sqlClient } from "../src/shared/db.js";

const MIGRATION = new URL("../migrations/0028_jurisdictions_level_check_validate.sql", import.meta.url);
// 0010's original, narrower definition, as it exists NOT VALID on UAT.
const CHECK = "CHECK (level IN ('state', 'district', 'block', 'gp', 'ward', 'zone'))";
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
    CREATE TABLE ${scratch}.jurisdictions (
      id uuid PRIMARY KEY, tenant_id uuid NOT NULL, level varchar(32) NOT NULL,
      updated_at timestamptz NOT NULL DEFAULT now());
    ALTER TABLE ${scratch}.jurisdictions ENABLE ROW LEVEL SECURITY;
    ALTER TABLE ${scratch}.jurisdictions FORCE ROW LEVEL SECURITY;
    CREATE POLICY t ON ${scratch}.jurisdictions
      USING (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid);`);
  await sql`select set_config('app.tenant_id', ${tenant}, true)`;
  for (const v of values) {
    await sql.unsafe(`INSERT INTO ${scratch}.jurisdictions (id, tenant_id, level) VALUES ('${randomUUID()}', '${tenant}', '${v}')`);
  }
  await sql.unsafe(`ALTER TABLE ${scratch}.jurisdictions ADD CONSTRAINT jurisdictions_level_check ${check} NOT VALID`);
  await sql`select set_config('app.tenant_id', '', true)`;
}

async function migrationFor(scratch: string): Promise<string> {
  return (await readFile(MIGRATION, "utf8"))
    .replace(/^\s*(BEGIN|COMMIT);\s*$/gim, "")
    .replace(/\bjurisdiction\.(jurisdictions)\b/g, `${scratch}.$1`);
}

describe("0028: widens and validates jurisdictions_level_check", () => {
  it("widens the CHECK to tehsil/subdivision without changing rows, validates it, keeps FORCE RLS, re-runs cleanly", async () => {
    const scratch = `f100_${randomUUID().replace(/-/g, "").slice(0, 12)}`;
    const tenant = randomUUID();
    const sqlText = await migrationFor(scratch);
    await inRolledBackTx(async (sql) => {
      await scratchState(sql, scratch, tenant, CHECK, ["tehsil", "subdivision", "district"]);
      await sql.unsafe(sqlText);
      await sql.unsafe(sqlText);

      const con = await sql<{ convalidated: boolean; force: boolean }[]>`
        SELECT c.convalidated, t.relforcerowsecurity AS force
          FROM pg_constraint c JOIN pg_class t ON t.oid = c.conrelid
         WHERE t.relnamespace = ${scratch}::regnamespace AND c.conname = 'jurisdictions_level_check'`;
      expect(con).toEqual([{ convalidated: true, force: true }]);

      await sql`select set_config('app.tenant_id', ${tenant}, true)`;
      const rows = await sql.unsafe<{ v: string }[]>(`SELECT level AS v FROM ${scratch}.jurisdictions ORDER BY level`);
      expect(rows.map((r) => r.v)).toEqual(["district", "subdivision", "tehsil"]);
      await expect(
        sql.unsafe(`INSERT INTO ${scratch}.jurisdictions (id, tenant_id, level) VALUES ('${randomUUID()}', '${tenant}', 'country')`),
      ).rejects.toThrow(/jurisdictions_level_check/);
    });
  });

  it("refuses a same-named constraint with a different definition instead of trusting the name", async () => {
    const scratch = `f100_${randomUUID().replace(/-/g, "").slice(0, 12)}`;
    const sqlText = await migrationFor(scratch);
    await inRolledBackTx(async (sql) => {
      await scratchState(sql, scratch, randomUUID(), "CHECK (level IS NOT NULL)", []);
      await expect(sql.unsafe(sqlText)).rejects.toThrow(/jurisdictions_level_check exists with a different definition/);
    });
  });

  it("the migrated jurisdiction schema has jurisdictions_level_check validated", async () => {
    const con = await sqlClient<{ convalidated: boolean }[]>`
      SELECT convalidated FROM pg_constraint WHERE conrelid = 'jurisdiction.jurisdictions'::regclass AND conname = 'jurisdictions_level_check'`;
    expect(con).toEqual([{ convalidated: true }]);
  });
});
