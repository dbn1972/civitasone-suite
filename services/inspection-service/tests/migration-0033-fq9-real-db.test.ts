/**
 * Migration 0033 (UAT FQ9 #24/#25) — behaviour on the old shape, re-runs, and a violating row.
 *
 * The inspection tables are owned by the admin role (admin-run migrations) and inspection_svc has
 * no CREATE/TEMP privilege, so the DB cases connect as the bootstrap superuser from the standard
 * PGHOST/PGPORT/PGUSER/PGPASSWORD env (set for the CI Tests job, as for scripts/ci/bootstrap-postgres.sh)
 * and are skipped only when that env is absent. The migration's own statements run against
 * session-temporary copies of the two tables in their pre-0033 shape (schema names rewritten to the
 * session's temp schema; nothing else in the SQL changes), inside a rolled-back transaction, so the
 * shared test database is never altered.
 *
 * Given the old shape (question_id uuid, integrity CHECK valid|tampered), When 0033 runs twice,
 * Then question_id is text with uuid values preserved and 'q-1-1' storable, and 'unverified' is
 * accepted with junk still rejected. Given an existing row that violates the new CHECK, Then 0033
 * still succeeds and the table keeps a CHECK (NOT VALID, enforced for new writes) — never none.
 */
import { describe, it, expect, afterAll } from "vitest";
import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import postgres from "postgres";

const MIGRATION = join(import.meta.dirname, "..", "migrations", "0033_findings_question_id_text_evidence_unverified.sql");
const SQL = readFileSync(MIGRATION, "utf8");

/** The migration text, pointed at this session's temp tables instead of the admin-owned ones. */
const TEMP_SQL = SQL
  .replace(/table_schema = 'findings' AND table_name = 'findings'/g,
    "table_schema = pg_my_temp_schema()::regnamespace::text AND table_name = 'fq9_findings'")
  .replace(/findings\.findings/g, "pg_temp.fq9_findings")
  .replace(/evidence\.evidence_artifacts/g, "pg_temp.fq9_evidence_artifacts");

class Rollback extends Error {}

const HAS_ADMIN = Boolean(process.env.PGUSER && process.env.PGPASSWORD);
const admin = HAS_ADMIN
  ? postgres({ database: "civitas_inspection", max: 1, onnotice: () => {} })
  : null;
type Sql = postgres.Sql;

afterAll(async () => { await admin?.end(); });

async function inOldShape(body: (tx: Sql) => Promise<void>): Promise<void> {
  if (!admin) throw new Error("admin connection required");
  try {
    await admin.begin(async (s) => {
      const tx = s as unknown as Sql;
      await tx`CREATE TEMP TABLE fq9_findings (id uuid PRIMARY KEY, question_id uuid)`;
      await tx`CREATE TEMP TABLE fq9_evidence_artifacts (
                 id uuid PRIMARY KEY, integrity_status varchar(16) NOT NULL DEFAULT 'valid',
                 CONSTRAINT evidence_artifacts_integrity_status_check CHECK (integrity_status IN ('valid', 'tampered')))`;
      await body(tx);
      throw new Rollback();
    });
  } catch (e) {
    if (!(e instanceof Rollback)) throw e;
  }
}

async function integrityCheck(tx: Sql) {
  return tx`SELECT convalidated, pg_get_constraintdef(oid) AS def FROM pg_constraint
            WHERE conname = 'evidence_artifacts_integrity_status_check' AND conrelid = 'pg_temp.fq9_evidence_artifacts'::regclass`;
}

describe("migration 0033 (UAT FQ9 #24/#25)", () => {
  it("rewrites every table reference (sanity: the test really targets the temp tables)", () => {
    expect(TEMP_SQL).not.toMatch(/findings\.findings|evidence\.evidence_artifacts|table_schema = 'findings'/);
  });

  // FLAKY-SKIP: env-gated — needs PG superuser (PGUSER/PGPASSWORD), set in the CI Tests job; runs in CI (expires: 2027-04-30)
  it.skipIf(!HAS_ADMIN)("old shape, run twice: question_id becomes text (uuids preserved), 'unverified' allowed, junk rejected, CHECK validated", async () => {
    await inOldShape(async (tx) => {
      const kept = randomUUID();
      await tx`INSERT INTO fq9_findings VALUES (${randomUUID()}, ${kept}), (${randomUUID()}, NULL)`;
      await tx`INSERT INTO fq9_evidence_artifacts (id, integrity_status) VALUES (${randomUUID()}, 'valid')`;

      await tx.unsafe(TEMP_SQL);
      await tx.unsafe(TEMP_SQL);

      const [col] = await tx`SELECT data_type FROM information_schema.columns
                             WHERE table_schema = pg_my_temp_schema()::regnamespace::text
                               AND table_name = 'fq9_findings' AND column_name = 'question_id'`;
      expect(col?.data_type).toBe("text");
      expect((await tx`SELECT 1 FROM fq9_findings WHERE question_id = ${kept}`)).toHaveLength(1);
      await tx`INSERT INTO fq9_findings VALUES (${randomUUID()}, 'q-1-1')`;

      await tx`INSERT INTO fq9_evidence_artifacts (id, integrity_status) VALUES (${randomUUID()}, 'unverified')`;
      await tx`SAVEPOINT s1`;
      await expect(tx`INSERT INTO fq9_evidence_artifacts (id, integrity_status) VALUES (${randomUUID()}, 'bogus')`)
        .rejects.toThrow(/evidence_artifacts_integrity_status_check/);
      await tx`ROLLBACK TO SAVEPOINT s1`;
      const cons = await integrityCheck(tx);
      expect(cons).toHaveLength(1);
      expect(cons[0]?.convalidated).toBe(true);
    });
  });

  // FLAKY-SKIP: env-gated — needs PG superuser (PGUSER/PGPASSWORD), set in the CI Tests job; runs in CI (expires: 2027-04-30)
  it.skipIf(!HAS_ADMIN)("an existing row that violates the new CHECK never leaves the table without one (NOT VALID + NOTICE)", async () => {
    await inOldShape(async (tx) => {
      await tx`ALTER TABLE fq9_evidence_artifacts DROP CONSTRAINT evidence_artifacts_integrity_status_check`;
      await tx`INSERT INTO fq9_evidence_artifacts (id, integrity_status) VALUES (${randomUUID()}, 'legacy_x')`;
      await tx`ALTER TABLE fq9_evidence_artifacts ADD CONSTRAINT evidence_artifacts_integrity_status_check
               CHECK (integrity_status IN ('valid', 'tampered')) NOT VALID`;

      await tx.unsafe(TEMP_SQL);
      await tx.unsafe(TEMP_SQL);

      const cons = await integrityCheck(tx);
      expect(cons).toHaveLength(1);
      expect(cons[0]?.convalidated).toBe(false);
      expect(cons[0]?.def).toContain("unverified");
      await tx`SAVEPOINT s2`;
      await expect(tx`INSERT INTO fq9_evidence_artifacts (id, integrity_status) VALUES (${randomUUID()}, 'bogus')`)
        .rejects.toThrow(/evidence_artifacts_integrity_status_check/);
      await tx`ROLLBACK TO SAVEPOINT s2`;
    });
  });

  it("drops and re-adds the CHECK inside one DO block under a lock_timeout (psql runs without --single-transaction)", () => {
    const code = SQL.replace(/^\s*--.*$/gm, "");
    expect(code).toMatch(/SET lock_timeout\s*=\s*'5s'/);
    const blocks = [...code.matchAll(/DO \$\$([\s\S]*?)\$\$;/g)].map((m) => m[1] ?? "");
    const ck = blocks.find((b) => b.includes("evidence_artifacts_integrity_status_check")) ?? "";
    expect(ck).toMatch(/DROP CONSTRAINT IF EXISTS evidence_artifacts_integrity_status_check/);
    expect(ck).toMatch(/ADD CONSTRAINT evidence_artifacts_integrity_status_check/);
    expect(code.replace(/DO \$\$[\s\S]*?\$\$;/g, "")).not.toMatch(/evidence_artifacts_integrity_status_check|ALTER TABLE/);
  });
});
