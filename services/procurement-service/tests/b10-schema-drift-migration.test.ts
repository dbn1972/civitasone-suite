/**
 * UAT bundle 10 (F100 schema drift): migration 0048 must converge the six
 * 0021-0024 UNIQUE constraints by DEFINITION, not by name.
 *
 * On UAT, CREATE TABLE IF NOT EXISTS found older tables, so the inline UNIQUE
 * constraints were never created; UAT has same-named standalone unique INDEXES
 * instead. Each case simulates a drifted state on the real, migration-built
 * tables inside a transaction that is always rolled back, then runs the real
 * migration text.
 */
import { describe, it, expect, afterAll } from "vitest";
import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { sqlClient } from "../src/shared/db.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const migration = readFileSync(join(__dirname, "../migrations/0048_b10_unique_constraints_converge.sql"), "utf8");

const SPECS = [
  ["planning.procurement_plans", "uq_proc_plans_tenant_no", "tenant_id, plan_no"],
  ["po.procurement_po_amendments", "uq_po_amendment_no", "po_id, amendment_no"],
  ["po.procurement_po_milestones", "uq_po_milestone_no", "po_id, milestone_no"],
  ["tender.procurement_prebid_queries", "uq_prebid_query_no", "tender_id, query_no"],
  ["tender.procurement_tender_corrigenda", "uq_tender_corrigendum_no", "tender_id, corrigendum_no"],
  ["vendor.procurement_vendor_scorecards", "uq_vscorecard_vendor_period", "tenant_id, vendor_id, period"],
] as const;

type Row = { con: string; contype: string; def: string; conindid: number };
const ROLLBACK = new Error("rollback");

async function inRolledBackTx(fn: (tx: typeof sqlClient) => Promise<void>): Promise<void> {
  await sqlClient
    .begin(async (tx) => {
      await fn(tx as unknown as typeof sqlClient);
      throw ROLLBACK;
    })
    .catch((e) => {
      if (e !== ROLLBACK) throw e;
    });
}

async function readAll(tx: typeof sqlClient): Promise<Row[]> {
  const out: Row[] = [];
  for (const [table, con] of SPECS) {
    const rows = (await tx.unsafe(`
      SELECT c.conname AS con, c.contype::text AS contype, pg_get_constraintdef(c.oid) AS def, c.conindid::int AS conindid
        FROM pg_constraint c
       WHERE c.conrelid = '${table}'::regclass AND c.conname = '${con}'`)) as unknown as Row[];
    out.push(...rows);
  }
  return out;
}

async function indexOid(tx: typeof sqlClient, table: string, name: string): Promise<number | undefined> {
  const schema = table.split(".")[0];
  const rows = (await tx.unsafe(
    `SELECT c.oid::int AS oid FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
      WHERE n.nspname = '${schema}' AND c.relname = '${name}'`,
  )) as unknown as { oid: number }[];
  return rows[0]?.oid;
}

afterAll(async () => {
  await sqlClient.end();
});

describe("migration 0048 — UNIQUE constraints converge by definition", () => {
  it("is a no-op on a migration-built database", async () => {
    await inRolledBackTx(async (tx) => {
      const before = await readAll(tx);
      expect(before).toHaveLength(SPECS.length);
      await tx.unsafe(migration);
      expect(await readAll(tx)).toEqual(before);
    });
  });

  it("promotes the UAT same-named unique INDEXES to constraints without rebuilding them", async () => {
    await inRolledBackTx(async (tx) => {
      const indexes: Record<string, number | undefined> = {};
      for (const [table, con, cols] of SPECS) {
        await tx.unsafe(`ALTER TABLE ${table} DROP CONSTRAINT ${con}`);
        await tx.unsafe(`CREATE UNIQUE INDEX ${con} ON ${table} (${cols})`);
        indexes[con] = await indexOid(tx, table, con);
      }
      expect(await readAll(tx)).toHaveLength(0);

      await tx.unsafe(migration);
      const after = await readAll(tx);
      expect(after).toHaveLength(SPECS.length);
      for (const [, con, cols] of SPECS) {
        const row = after.find((r) => r.con === con)!;
        expect(row.contype).toBe("u");
        expect(row.def).toBe(`UNIQUE (${cols})`);
        expect(row.conindid).toBe(indexes[con]);
      }

      await tx.unsafe(migration);
      expect(await readAll(tx)).toEqual(after);
    });
  });

  it("recreates a same-named constraint whose definition differs, and replaces a mismatched index", async () => {
    await inRolledBackTx(async (tx) => {
      const [t0, c0, cols0] = SPECS[0];
      const [t1, c1, cols1] = SPECS[1];
      await tx.unsafe(`ALTER TABLE ${t0} DROP CONSTRAINT ${c0}`);
      await tx.unsafe(`ALTER TABLE ${t0} ADD CONSTRAINT ${c0} UNIQUE (plan_no)`);
      await tx.unsafe(`ALTER TABLE ${t1} DROP CONSTRAINT ${c1}`);
      await tx.unsafe(`CREATE UNIQUE INDEX ${c1} ON ${t1} (po_id)`);

      await tx.unsafe(migration);
      const after = await readAll(tx);
      expect(after.find((r) => r.con === c0)?.def).toBe(`UNIQUE (${cols0})`);
      expect(after.find((r) => r.con === c1)?.def).toBe(`UNIQUE (${cols1})`);
    });
  });
});
