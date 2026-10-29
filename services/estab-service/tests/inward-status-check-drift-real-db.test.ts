/**
 * UAT FQ9 #20: POST /v1/estab/inward/:id/open-file was accepted but the DAK stayed 'received'.
 * The files consumer sets inward.status = 'file_opened' (0031's documented set), but UAT carries an
 * older estab_inward_status_check without 'file_opened' — 0031 adds the constraint under
 * `WHEN duplicate_object THEN NULL`, so a pre-existing constraint of that name was never replaced.
 * Given a database whose CHECK has drifted to the old set, When 0060 is applied, Then an inward row
 * can be moved to 'file_opened' and an unknown status is still rejected. Runs in a rolled-back
 * transaction so the shared test database keeps its own constraint.
 */
import { describe, it, expect, afterAll } from "vitest";
import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { sqlClient } from "../src/shared/db.js";

const TENANT = "c0ff33aa-0000-4000-8000-0000000009f9";
const ACTOR = randomUUID();
const MIGRATION = join(import.meta.dirname, "..", "migrations", "0060_inward_status_check_file_opened.sql");

class Rollback extends Error {}

afterAll(async () => { await sqlClient.end(); });

async function inDriftedDb(body: (tx: typeof sqlClient) => Promise<void>): Promise<void> {
  try {
    await sqlClient.begin(async (s) => {
      const tx = s as unknown as typeof sqlClient;
      await tx`ALTER TABLE files.estab_inward DROP CONSTRAINT IF EXISTS estab_inward_status_check`;
      await tx`ALTER TABLE files.estab_inward ADD CONSTRAINT estab_inward_status_check
               CHECK (status IN ('received', 'acknowledged', 'attached', 'detached'))`;
      await tx`select set_config('app.tenant_id', ${TENANT}, true)`;
      await body(tx);
      throw new Rollback();
    });
  } catch (e) {
    if (!(e instanceof Rollback)) throw e;
  }
}

async function insertInward(tx: typeof sqlClient): Promise<string> {
  const id = randomUUID();
  await tx`INSERT INTO files.estab_inward (id, tenant_id, dak_no, from_address, subject, status, created_by, updated_by)
           VALUES (${id}, ${TENANT}, ${"DAK/FQ9/" + id.slice(0, 8)}, 'Ministry', 'Drift', 'received', ${ACTOR}, ${ACTOR})`;
  return id;
}

describe("estab_inward_status_check drift (UAT FQ9 #20)", () => {
  it("the drifted CHECK rejects 'file_opened' (reproduces UAT)", async () => {
    await inDriftedDb(async (tx) => {
      const id = await insertInward(tx);
      await tx`SAVEPOINT s1`;
      await expect(tx`UPDATE files.estab_inward SET status = 'file_opened' WHERE id = ${id}`)
        .rejects.toThrow(/estab_inward_status_check/);
      await tx`ROLLBACK TO SAVEPOINT s1`;
    });
  });

  it("after 0060 (applied twice: idempotent), 'file_opened' is accepted and junk is rejected", async () => {
    const ddl = readFileSync(MIGRATION, "utf8");
    await inDriftedDb(async (tx) => {
      await tx.unsafe(ddl);
      await tx.unsafe(ddl);
      const id = await insertInward(tx);
      await tx`UPDATE files.estab_inward SET status = 'file_opened' WHERE id = ${id}`;
      const [row] = await tx`SELECT status FROM files.estab_inward WHERE id = ${id}`;
      expect(row?.status).toBe("file_opened");
      await tx`SAVEPOINT s2`;
      await expect(tx`UPDATE files.estab_inward SET status = 'bogus' WHERE id = ${id}`).rejects.toThrow(/estab_inward_status_check/);
      await tx`ROLLBACK TO SAVEPOINT s2`;
    });
  });
});
