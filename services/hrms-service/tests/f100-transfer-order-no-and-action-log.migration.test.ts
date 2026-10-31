/**
 * UAT F100, hrms-service.
 *  - 0185 refuses to build ux_hrms_transfers_order_no while duplicates exist; on UAT a test
 *    fixture tenant holds 112 transfers numbered 'TO/2026/001', so the index never existed.
 *    0255 suffixes the later duplicates of THAT test tenant only and builds the index.
 *  - 0135 fails on UAT ("created_at does not exist") because audit.hr_action_log predates it
 *    with an occurred_at column, so its time-ordered indexes were never built. 0256 builds
 *    them on whichever time column the table has.
 * Each case rebuilds the UAT shape in a throwaway schema, runs the migration twice and rolls
 * back.
 */
import { describe, it, expect, afterAll } from "vitest";
import { randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import { sqlClient } from "../src/shared/db.js";

const TEST_TENANT = "aaaaaaaa-1111-4000-8000-000000000099";
const ROLLBACK = new Error("rollback");

afterAll(async () => {
  await sqlClient.end();
});

const scratchName = () => `f100_${randomUUID().replace(/-/g, "").slice(0, 12)}`;

async function migration(file: string, rewrite: RegExp, scratch: string): Promise<string> {
  return (await readFile(new URL(`../migrations/${file}`, import.meta.url), "utf8"))
    .replace(/^\s*(BEGIN|COMMIT);\s*$/gim, "")
    .replace(rewrite, `${scratch}.$1`);
}

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

describe("0255: de-duplicates the test tenant's transfer order numbers, then enforces uniqueness", () => {
  const REWRITE = /\blifecycle\.(hrms_transfers|ux_hrms_transfers_order_no)\b/g;

  async function seed(sql: typeof sqlClient, scratch: string, rows: [string, string, string][]) {
    await sql.unsafe(`
      CREATE SCHEMA ${scratch};
      CREATE TABLE ${scratch}.hrms_transfers (
        id uuid PRIMARY KEY, tenant_id uuid NOT NULL, order_no varchar(64),
        created_at timestamptz NOT NULL, updated_at timestamptz NOT NULL DEFAULT now());
      ALTER TABLE ${scratch}.hrms_transfers ENABLE ROW LEVEL SECURITY;
      ALTER TABLE ${scratch}.hrms_transfers FORCE ROW LEVEL SECURITY;
      CREATE POLICY t ON ${scratch}.hrms_transfers
        USING (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid);`);
    for (const [tenant, orderNo, createdAt] of rows) {
      await sql`select set_config('app.tenant_id', ${tenant}, true)`;
      await sql.unsafe(`INSERT INTO ${scratch}.hrms_transfers (id, tenant_id, order_no, created_at)
                        VALUES ('${randomUUID()}', '${tenant}', '${orderNo}', '${createdAt}')`);
    }
    await sql`select set_config('app.tenant_id', '', true)`;
  }

  it("keeps the earliest number, suffixes the rest as TESTDUP, builds the unique index, re-runs cleanly", async () => {
    const scratch = scratchName();
    const other = randomUUID();
    const sqlText = await migration("0255_hrms_transfers_order_no_dedupe.sql", REWRITE, scratch);
    await inRolledBackTx(async (sql) => {
      await seed(sql, scratch, [
        [TEST_TENANT, "TO/2026/001", "2026-09-05T12:00Z"],
        [TEST_TENANT, "TO/2026/001", "2026-09-06T12:00Z"],
        [TEST_TENANT, "to/2026/001", "2026-09-07T12:00Z"],
        [other, "TO/2026/001", "2026-09-05T12:00Z"],
      ]);
      await sql.unsafe(sqlText);
      await sql.unsafe(sqlText);

      await sql`select set_config('app.tenant_id', ${TEST_TENANT}, true)`;
      const rows = await sql.unsafe<{ order_no: string }[]>(
        `SELECT order_no FROM ${scratch}.hrms_transfers ORDER BY created_at`);
      expect(rows.map((r) => r.order_no)).toEqual(["TO/2026/001", "TO/2026/001-TESTDUP-001", "to/2026/001-TESTDUP-002"]);

      const idx = await sql<{ indexdef: string }[]>`
        SELECT indexdef FROM pg_indexes WHERE schemaname = ${scratch} AND indexname = 'ux_hrms_transfers_order_no'`;
      expect(idx[0]?.indexdef).toMatch(/UNIQUE INDEX .*\(tenant_id, lower\(\(order_no\)::text\)\) WHERE \(order_no IS NOT NULL\)/);
      await expect(
        sql.unsafe(`INSERT INTO ${scratch}.hrms_transfers (id, tenant_id, order_no, created_at)
                    VALUES ('${randomUUID()}', '${TEST_TENANT}', 'To/2026/001', now())`),
      ).rejects.toThrow(/ux_hrms_transfers_order_no/);
    });
  });

  it("never renames real data: duplicates in any other tenant still fail loudly", async () => {
    const scratch = scratchName();
    const real = randomUUID();
    const sqlText = await migration("0255_hrms_transfers_order_no_dedupe.sql", REWRITE, scratch);
    await inRolledBackTx(async (sql) => {
      await seed(sql, scratch, [
        [real, "TO/2026/007", "2026-09-05T12:00Z"],
        [real, "TO/2026/007", "2026-09-06T12:00Z"],
      ]);
      await expect(sql.unsafe(sqlText)).rejects.toThrow(/duplicate transfer order numbers exist/);
    });
  });

  it("the migrated hrms schema has the unique index", async () => {
    const idx = await sqlClient<{ n: number }[]>`
      SELECT count(*)::int AS n FROM pg_index i
       WHERE i.indexrelid = to_regclass('lifecycle.ux_hrms_transfers_order_no') AND i.indisunique AND i.indisvalid`;
    expect(idx[0]?.n).toBe(1);
  });
});

describe("0256: 0135's time-ordered audit indexes on the live (occurred_at) shape", () => {
  const REWRITE = /\baudit\.(hr_action_log)\b/g;

  it("builds the tenant/time index on occurred_at, reuses an existing actor index, re-runs cleanly", async () => {
    const scratch = scratchName();
    const sqlText = await migration("0256_audit_hr_action_log_time_indexes.sql", REWRITE, scratch);
    await inRolledBackTx(async (sql) => {
      await sql.unsafe(`
        CREATE SCHEMA ${scratch};
        CREATE TABLE ${scratch}.hr_action_log (
          id uuid PRIMARY KEY, tenant_id uuid NOT NULL, actor_id text, entity_type text, entity_id text,
          occurred_at timestamptz NOT NULL DEFAULT now());
        CREATE INDEX hr_action_log_tenant_actor_idx ON ${scratch}.hr_action_log (tenant_id, actor_id, occurred_at DESC);`);
      await sql.unsafe(sqlText);
      await sql.unsafe(sqlText);
      const idx = await sql<{ indexname: string; indexdef: string }[]>`
        SELECT indexname, indexdef FROM pg_indexes WHERE schemaname = ${scratch} ORDER BY indexname`;
      expect(idx.map((i) => i.indexname)).toEqual([
        "hr_action_log_pkey", "hr_action_log_tenant_actor_idx", "idx_hr_action_log_tenant_created",
      ]);
      expect(idx[2]?.indexdef).toMatch(/\(tenant_id, occurred_at DESC\)$/);
    });
  });

  it("the migrated hrms schema has both 0135 time-ordered indexes", async () => {
    const idx = await sqlClient<{ n: number }[]>`
      SELECT count(*)::int AS n FROM pg_indexes
       WHERE schemaname = 'audit' AND tablename = 'hr_action_log'
         AND indexname IN ('idx_hr_action_log_tenant_created', 'idx_hr_action_log_actor')`;
    expect(idx[0]?.n).toBe(2);
  });
});
