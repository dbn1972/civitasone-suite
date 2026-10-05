/**
 * Hardened deployment: when the migrations ran with civitas.document_migration_owner, the service role document_svc owns NOTHING
 * in bulk_scan and holds DML only, so it cannot drop / disable the file_events append-only triggers, replace their function or
 * TRUNCATE. BULK_SCAN_TEST_OWNER_DATABASE_URL = a document_svc connection string to such a database.
 */
import { describe, it, expect, afterAll } from "vitest";
import postgres from "postgres";

const URL_ = process.env.BULK_SCAN_TEST_OWNER_DATABASE_URL;
// FLAKY-SKIP: environment-gated on a migration-owner provisioned database (expires: 2027-10-01)
describe.skipIf(!URL_)("migration-owner deployment: document_svc cannot tamper with file_events", () => {
  const sql = postgres(URL_ as string, { max: 1 });
  afterAll(async () => { await sql.end(); });

  it("document_svc owns no bulk_scan table, schema or function", async () => {
    const me = (await sql`SELECT current_user AS u`)[0]?.u as string;
    expect(me).toBe("document_svc");
    const owners = await sql`SELECT tablename, tableowner FROM pg_tables WHERE schemaname = 'bulk_scan'`;
    expect(owners.length).toBeGreaterThanOrEqual(7);
    for (const o of owners) expect(o.tableowner, o.tablename as string).not.toBe("document_svc");
    expect((await sql`SELECT nspowner::regrole::text AS o FROM pg_namespace WHERE nspname = 'bulk_scan'`)[0]?.o).not.toBe("document_svc");
    const fns = await sql`SELECT p.proowner::regrole::text AS o FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace WHERE n.nspname = 'bulk_scan'`;
    expect(fns.length).toBeGreaterThan(0);
    for (const f of fns) expect(f.o).not.toBe("document_svc");
  });

  it("holds DML only: no TRUNCATE / TRIGGER / REFERENCES anywhere, file_events is SELECT + INSERT only", async () => {
    const rows = await sql`SELECT c.relname AS t,
        has_table_privilege('document_svc', c.oid, 'SELECT') AS sel, has_table_privilege('document_svc', c.oid, 'INSERT') AS ins,
        has_table_privilege('document_svc', c.oid, 'UPDATE') AS upd, has_table_privilege('document_svc', c.oid, 'DELETE') AS del,
        has_table_privilege('document_svc', c.oid, 'TRUNCATE') AS trunc, has_table_privilege('document_svc', c.oid, 'TRIGGER') AS trg,
        has_table_privilege('document_svc', c.oid, 'REFERENCES') AS ref
      FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace WHERE n.nspname = 'bulk_scan' AND c.relkind = 'r'`;
    for (const r of rows) {
      expect([r.trunc, r.trg, r.ref], r.t as string).toEqual([false, false, false]);
      expect([r.sel, r.ins], r.t as string).toEqual([true, true]);
      if (r.t === "file_events") expect([r.upd, r.del]).toEqual([false, false]);
      else expect([r.upd, r.del], r.t as string).toEqual([true, true]);
    }
  });

  it("cannot DROP / DISABLE the triggers, REPLACE the function, TRUNCATE, ALTER or DROP the table", async () => {
    await expect(sql.unsafe("DROP TRIGGER trg_bulk_scan_file_events_append_only ON bulk_scan.file_events")).rejects.toThrow(/must be owner|permission denied/);
    await expect(sql.unsafe("DROP TRIGGER trg_bulk_scan_file_events_no_truncate ON bulk_scan.file_events")).rejects.toThrow(/must be owner|permission denied/);
    await expect(sql.unsafe("ALTER TABLE bulk_scan.file_events DISABLE TRIGGER ALL")).rejects.toThrow(/must be owner|permission denied/);
    await expect(sql.unsafe("CREATE OR REPLACE FUNCTION bulk_scan.file_events_append_only() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RETURN NULL; END $$")).rejects.toThrow(/must be owner|permission denied/);
    await expect(sql.unsafe("TRUNCATE bulk_scan.file_events")).rejects.toThrow(/permission denied/);
    await expect(sql.unsafe("DROP TABLE bulk_scan.file_events")).rejects.toThrow(/must be owner/);
    await expect(sql.unsafe("UPDATE bulk_scan.file_events SET reason = 'x'")).rejects.toThrow(/permission denied/);
    await expect(sql.unsafe("DELETE FROM bulk_scan.file_events")).rejects.toThrow(/permission denied/);
  });
});
