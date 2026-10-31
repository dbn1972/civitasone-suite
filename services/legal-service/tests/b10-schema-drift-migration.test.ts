/**
 * UAT bundle 10 (F100 schema drift): migration 0038_b10_counsel_brief_status_check.sql must converge
 * counsel.legal_counsel_briefs.legal_counsel_briefs_status_check by DEFINITION, not by name.
 *
 * On UAT the original migration was a silent no-op (0011 swallowed duplicate_object, keeping an older CHECK that rejects the app's accepted/withdrawn). Each case
 * simulates that drifted state on the real, migration-built table inside a
 * transaction that is always rolled back, runs the real migration text, and
 * checks pg_get_constraintdef against the migration-built definition.
 */
import { describe, it, expect, afterAll } from "vitest";
import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { sqlClient } from "../src/shared/db.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const migration = readFileSync(join(__dirname, "../migrations/0038_b10_counsel_brief_status_check.sql"), "utf8");

const TABLE = "counsel.legal_counsel_briefs";
const CON = "legal_counsel_briefs_status_check";
/** The UAT state: null = constraint absent, otherwise the stale same-named definition. */
const UAT_DRIFT: string | null = "CHECK (status IN ('assigned', 'in_progress', 'completed', 'cancelled'))";

type Con = { oid: number; def: string; validated: boolean };
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

async function readCon(tx: typeof sqlClient): Promise<Con[]> {
  return (await tx.unsafe(`
    SELECT c.oid::int AS oid, pg_get_constraintdef(c.oid) AS def, c.convalidated AS validated
      FROM pg_constraint c
     WHERE c.conrelid = '${TABLE}'::regclass AND c.conname = '${CON}'`)) as unknown as Con[];
}

afterAll(async () => {
  await sqlClient.end();
});

describe("migration 0038_b10_counsel_brief_status_check.sql — converges by definition, idempotent", () => {
  it("is a no-op on a migration-built database (same object, not recreated)", async () => {
    await inRolledBackTx(async (tx) => {
      const before = await readCon(tx);
      expect(before).toHaveLength(1);
      await tx.unsafe(migration);
      expect(await readCon(tx)).toEqual(before);
    });
  });

  it("leaves a dump/restored deparse of the same CHECK alone (no churn on every deploy)", async () => {
    await inRolledBackTx(async (tx) => {
      const [built] = await readCon(tx);
      // Re-adding the deparsed text yields the form a pg_dump/restore produces:
      // ANY (ARRAY[('a'::character varying)::text, ...]) instead of ANY ((ARRAY[...])::text[]).
      await tx.unsafe(`ALTER TABLE ${TABLE} DROP CONSTRAINT ${CON}`);
      await tx.unsafe(`ALTER TABLE ${TABLE} ADD CONSTRAINT ${CON} ${built!.def}`);
      const restored = await readCon(tx);
      expect(restored[0]!.def).not.toBe(built!.def);
      await tx.unsafe(migration);
      expect(await readCon(tx)).toEqual(restored);
    });
  });

  it("repairs the UAT drift to the migration-built definition, then a re-run changes nothing", async () => {
    await inRolledBackTx(async (tx) => {
      const [built] = await readCon(tx);
      await tx.unsafe(`ALTER TABLE ${TABLE} DROP CONSTRAINT ${CON}`);
      if (UAT_DRIFT !== null) await tx.unsafe(`ALTER TABLE ${TABLE} ADD CONSTRAINT ${CON} ${UAT_DRIFT}`);
      const drifted = await readCon(tx);
      expect(drifted.map((c) => c.def)).not.toEqual([built!.def]);

      await tx.unsafe(migration);
      const first = await readCon(tx);
      expect(first).toHaveLength(1);
      expect(first[0]!.def).toBe(built!.def);
      expect(first[0]!.validated).toBe(true);

      await tx.unsafe(migration);
      expect(await readCon(tx)).toEqual(first);
    });
  });
});
