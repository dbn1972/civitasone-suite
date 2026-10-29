/**
 * FQ9 #2 / review of PR #2373: migration 0037 must be atomic and safe.
 *
 * migrate-all.mjs runs psql without --single-transaction, so the drop + re-add of
 * legal_settlements_status_check must never leave the table with NO check. Each case
 * runs the real migration text against a scratch copy of the table, inside a
 * transaction that is always rolled back.
 */
import { describe, it, expect, afterAll } from "vitest";
import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { sqlClient } from "../src/shared/db.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const SCHEMA = "uat_s0037";
const migration = readFileSync(join(__dirname, "../migrations/0037_settlement_status_check_reconcile.sql"), "utf8");
const scoped = migration.replaceAll("settlements.legal_settlements", `${SCHEMA}.legal_settlements`);

const ORIGINAL_CHECK = "CHECK (status IN ('draft', 'settled'))";

type Constraint = { def: string; validated: boolean };

/** Run `fn` against a scratch legal_settlements carrying the 0011 constraint, then roll back. */
async function withScratchTable(
  seedStatuses: string[],
  fn: (tx: typeof sqlClient) => Promise<void>,
): Promise<void> {
  const ROLLBACK = new Error("rollback");
  await sqlClient
    .begin(async (tx) => {
      await tx.unsafe(`CREATE SCHEMA ${SCHEMA}`);
      await tx.unsafe(`CREATE TABLE ${SCHEMA}.legal_settlements (
        id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        status varchar(24) NOT NULL DEFAULT 'draft')`);
      for (const s of seedStatuses) {
        await tx.unsafe(`INSERT INTO ${SCHEMA}.legal_settlements (status) VALUES ('${s}')`);
      }
      // As in 0011: added NOT VALID, so legacy rows outside the set can pre-exist.
      await tx.unsafe(`ALTER TABLE ${SCHEMA}.legal_settlements
        ADD CONSTRAINT legal_settlements_status_check ${ORIGINAL_CHECK} NOT VALID`);
      await fn(tx as unknown as typeof sqlClient);
      throw ROLLBACK;
    })
    .catch((e) => {
      if (e !== ROLLBACK) throw e;
    });
}

async function readConstraint(tx: typeof sqlClient): Promise<Constraint[]> {
  return (await tx.unsafe(`
    SELECT pg_get_constraintdef(c.oid) AS def, c.convalidated AS validated
      FROM pg_constraint c
     WHERE c.conname = 'legal_settlements_status_check'
       AND c.conrelid = '${SCHEMA}.legal_settlements'::regclass`)) as unknown as Constraint[];
}

afterAll(async () => {
  await sqlClient.end();
});

describe("migration 0037 — atomic, safe, idempotent", () => {
  it("only touches the scoped table (scratch rewrite covers every reference)", () => {
    expect(scoped).not.toContain("settlements.legal_settlements");
  });

  it("keeps the ORIGINAL constraint when a row violates the new set (never leaves the table unchecked)", async () => {
    let before: Constraint[] = [];
    let after: Constraint[] = [];
    await withScratchTable(["draft", "legacy_unknown"], async (tx) => {
      before = await readConstraint(tx);
      await tx.unsafe(scoped);
      after = await readConstraint(tx);
    });
    expect(before).toHaveLength(1);
    expect(after).toHaveLength(1);
    expect(after[0]!.def).toBe(before[0]!.def);
    expect(after[0]!.def).not.toContain("executed");
  });

  it("applies the reconciled, VALIDATED constraint and is idempotent when run twice", async () => {
    const runs: Constraint[][] = [];
    await withScratchTable(["draft", "settled"], async (tx) => {
      await tx.unsafe(scoped);
      runs.push(await readConstraint(tx));
      await tx.unsafe(scoped);
      runs.push(await readConstraint(tx));
    });
    for (const c of runs) {
      expect(c).toHaveLength(1);
      expect(c[0]!.validated).toBe(true);
      for (const s of ["draft", "proposed", "accepted", "rejected", "executed", "settled"]) {
        expect(c[0]!.def).toContain(`'${s}'`);
      }
    }
    expect(runs[1]![0]!.def).toBe(runs[0]![0]!.def);
  });
});
