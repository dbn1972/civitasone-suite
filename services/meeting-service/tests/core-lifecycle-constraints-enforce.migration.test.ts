/**
 * UAT F100: migrations/0010_core_lifecycle_constraints.sql never took effect on live UAT.
 * Its single DO block hit 1 orphan FQ9-RUNNER test meeting (committee missing) and
 * attendance rows with check_out_at <= check_in_at written by the attendance-bounds test
 * fixture, rolled back, and the tolerant deploy runner hid the error, so all 17 CHECK/FK
 * constraints were missing. 0015_core_lifecycle_constraints_enforce.sql repairs exactly
 * those test rows (backing up the old values) and fails loudly on anything else.
 *
 * Each case rebuilds the UAT situation (FORCE-RLS tables, no constraints, the blocking
 * rows) in a throwaway schema, runs 0015 as the table owner and rolls everything back.
 */
import { describe, it, expect, afterAll } from "vitest";
import { randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import { sqlClient } from "../src/shared/db.js";

const MIGRATION = new URL("../migrations/0015_core_lifecycle_constraints_enforce.sql", import.meta.url);
const TEST_MEETING = "baa2a61c-5794-3424-5339-7ddd1f8380f7";
const FIXTURE_TITLE = "Attendance-bounds fixture meeting";
const EXPECTED = [
  "chk_meetings_status", "chk_meetings_type", "chk_meetings_confidentiality_level",
  "fk_meetings_committee_id", "fk_meetings_series_id",
  "chk_participants_role", "chk_participants_invitation_status", "chk_participants_attendance_mode",
  "chk_agenda_items_status", "chk_agenda_items_outcome_type", "chk_agenda_items_category",
  "chk_agenda_items_confidentiality_level", "fk_agenda_items_deferred_to",
  "chk_attendance_method", "chk_attendance_mode", "chk_attendance_status",
  "chk_attendance_checkout_after_checkin",
].sort();
const TABLES = ["meetings", "committees", "meeting_series", "participants", "agenda_items", "attendance_records"];
const REWRITE = new RegExp(`\\bmeeting\\.(${[...TABLES, "f100_repair_backup"].join("|")})\\b`, "g");
const ROLLBACK = new Error("rollback");

afterAll(async () => {
  await sqlClient.end();
});

const scratchName = () => `f100_${randomUUID().replace(/-/g, "").slice(0, 12)}`;

async function migrationFor(scratch: string): Promise<string> {
  return (await readFile(MIGRATION, "utf8"))
    .replace(/^\s*(BEGIN|COMMIT);\s*$/gim, "")
    .replace(REWRITE, `${scratch}.$1`);
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

async function createScratch(sql: typeof sqlClient, scratch: string): Promise<void> {
  await sql.unsafe(`
    CREATE SCHEMA ${scratch};
    CREATE TABLE ${scratch}.committees (id uuid PRIMARY KEY, tenant_id uuid NOT NULL);
    CREATE TABLE ${scratch}.meeting_series (id uuid PRIMARY KEY, tenant_id uuid NOT NULL);
    CREATE TABLE ${scratch}.meetings (
      id uuid PRIMARY KEY, tenant_id uuid NOT NULL, title text NOT NULL,
      committee_id uuid, series_id uuid,
      status varchar(32) NOT NULL DEFAULT 'draft', type varchar(32) NOT NULL DEFAULT 'committee',
      confidentiality_level varchar(16) NOT NULL DEFAULT 'internal',
      updated_at timestamptz NOT NULL DEFAULT now());
    CREATE TABLE ${scratch}.participants (
      id uuid PRIMARY KEY, tenant_id uuid NOT NULL, role varchar(32) NOT NULL DEFAULT 'member',
      invitation_status varchar(16) NOT NULL DEFAULT 'pending', attendance_mode varchar(16));
    CREATE TABLE ${scratch}.agenda_items (
      id uuid PRIMARY KEY, tenant_id uuid NOT NULL, deferred_to uuid,
      status varchar(24) NOT NULL DEFAULT 'proposed', outcome_type varchar(24) NOT NULL DEFAULT 'decision',
      category varchar(32), confidentiality_level varchar(16) NOT NULL DEFAULT 'internal',
      updated_at timestamptz NOT NULL DEFAULT now());
    CREATE TABLE ${scratch}.attendance_records (
      id uuid PRIMARY KEY, tenant_id uuid NOT NULL, meeting_id uuid NOT NULL,
      method varchar(16) NOT NULL DEFAULT 'manual',
      mode varchar(16) NOT NULL DEFAULT 'in_person', status varchar(16) NOT NULL DEFAULT 'present',
      check_in_at timestamptz NOT NULL, check_out_at timestamptz,
      updated_at timestamptz NOT NULL DEFAULT now());`);
  for (const t of TABLES) {
    await sql.unsafe(`
      ALTER TABLE ${scratch}.${t} ENABLE ROW LEVEL SECURITY;
      ALTER TABLE ${scratch}.${t} FORCE ROW LEVEL SECURITY;
      CREATE POLICY t ON ${scratch}.${t}
        USING (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid);`);
  }
}

/** Runs `stmts` as `tenant`, then clears the tenant like the deploy runner (no tenant set). */
async function asTenant(sql: typeof sqlClient, tenant: string, stmts: string): Promise<void> {
  await sql`select set_config('app.tenant_id', ${tenant}, true)`;
  await sql.unsafe(stmts);
  await sql`select set_config('app.tenant_id', '', true)`;
}

async function constraintsOn(sql: typeof sqlClient, schema: string) {
  return sql<{ conname: string; convalidated: boolean }[]>`
    SELECT conname, convalidated FROM pg_constraint
     WHERE connamespace = ${schema}::regnamespace AND conname = ANY(${EXPECTED})
     ORDER BY conname`;
}

describe("0015: repairs only the identified UAT test rows and makes the 0010 constraints real", () => {
  it("archives the FQ9 meeting, clears fixture check-outs, backs up old values, validates all 17, idempotently", async () => {
    const scratch = scratchName();
    const tenant = randomUUID();
    const committee = randomUUID();
    const series = randomUUID();
    const linked = randomUUID();
    const fixture = randomUUID();
    const goodAttendance = randomUUID();
    const badAttendance = randomUUID();
    const deadCommittee = randomUUID();
    const migration = await migrationFor(scratch);

    await inRolledBackTx(async (sql) => {
      await createScratch(sql, scratch);
      await asTenant(sql, tenant, `
        INSERT INTO ${scratch}.committees VALUES ('${committee}', '${tenant}');
        INSERT INTO ${scratch}.meeting_series VALUES ('${series}', '${tenant}');
        INSERT INTO ${scratch}.meetings (id, tenant_id, title, committee_id, series_id) VALUES
          ('${TEST_MEETING}', '${tenant}', 'FQ9-RUNNER-mtg-4e4202', '${deadCommittee}', NULL),
          ('${linked}', '${tenant}', 'Real meeting', '${committee}', '${series}'),
          ('${fixture}', '${tenant}', '${FIXTURE_TITLE}', NULL, NULL);
        INSERT INTO ${scratch}.attendance_records (id, tenant_id, meeting_id, check_in_at, check_out_at) VALUES
          ('${goodAttendance}', '${tenant}', '${linked}', '2026-09-01T10:00Z', '2026-09-01T11:00Z'),
          ('${badAttendance}', '${tenant}', '${fixture}', '2026-09-01T10:00Z', '2026-09-01T09:00Z');`);

      expect(await constraintsOn(sql, scratch)).toEqual([]);

      await sql.unsafe(migration);
      await sql.unsafe(migration); // re-run: must be a clean no-op

      const cons = await constraintsOn(sql, scratch);
      expect(cons.map((c) => c.conname)).toEqual(EXPECTED);
      expect(cons.every((c) => c.convalidated)).toBe(true);

      await sql`select set_config('app.tenant_id', ${tenant}, true)`;
      const meetings = await sql.unsafe<{ id: string; committee_id: string | null; series_id: string | null; archived: boolean }[]>(
        `SELECT id, committee_id, series_id, test_data_archived_at IS NOT NULL AS archived
           FROM ${scratch}.meetings ORDER BY title`);
      expect(meetings).toEqual([
        { id: fixture, committee_id: null, series_id: null, archived: false },
        { id: TEST_MEETING, committee_id: null, series_id: null, archived: true },
        { id: linked, committee_id: committee, series_id: series, archived: false },
      ]);
      const att = await sql.unsafe<{ id: string; out: boolean }[]>(
        `SELECT id, check_out_at IS NOT NULL AS out FROM ${scratch}.attendance_records ORDER BY check_out_at NULLS LAST`);
      expect(att).toEqual([{ id: goodAttendance, out: true }, { id: badAttendance, out: false }]);

      const backup = await sql.unsafe<{ table_name: string; row_id: string; column_name: string; old_value: string }[]>(
        `SELECT table_name, row_id, column_name, old_value FROM ${scratch}.f100_repair_backup ORDER BY table_name`);
      expect(backup.map((b) => [b.table_name, b.row_id, b.column_name])).toEqual([
        ["attendance_records", badAttendance, "check_out_at"],
        ["meetings", TEST_MEETING, "committee_id"],
      ]);
      expect(backup[1]?.old_value).toBe(deadCommittee);
      const restored = await sql.unsafe<{ same: boolean }[]>(
        `SELECT old_value::timestamptz = '2026-09-01T09:00Z'::timestamptz AS same
           FROM ${scratch}.f100_repair_backup WHERE table_name = 'attendance_records'`);
      expect(restored).toEqual([{ same: true }]);

      const force = await sql<{ n: number }[]>`
        SELECT count(*)::int AS n FROM pg_class
         WHERE relnamespace = ${scratch}::regnamespace AND relkind = 'r' AND relforcerowsecurity`;
      expect(force[0]?.n).toBe(TABLES.length + 1);

      await expect(
        sql.unsafe(`INSERT INTO ${scratch}.attendance_records (id, tenant_id, meeting_id, check_in_at, check_out_at)
                    VALUES ('${randomUUID()}', '${tenant}', '${fixture}', '2026-09-01T10:00Z', '2026-09-01T10:00Z')`),
      ).rejects.toThrow(/chk_attendance_checkout_after_checkin/);
    });
  });

  it("fails loudly, changing nothing, on a bad check-out outside the test fixture", async () => {
    const scratch = scratchName();
    const tenant = randomUUID();
    const real = randomUUID();
    const migration = await migrationFor(scratch);
    await inRolledBackTx(async (sql) => {
      await createScratch(sql, scratch);
      await asTenant(sql, tenant, `
        INSERT INTO ${scratch}.meetings (id, tenant_id, title) VALUES ('${real}', '${tenant}', 'Real meeting');
        INSERT INTO ${scratch}.attendance_records (id, tenant_id, meeting_id, check_in_at, check_out_at)
          VALUES ('${randomUUID()}', '${tenant}', '${real}', '2026-09-01T10:00Z', '2026-09-01T09:00Z');`);
      await expect(sql.unsafe(migration)).rejects.toThrow(/outside the test fixture have check_out_at <= check_in_at/);
    });
  });

  it("fails loudly on a dangling committee that is not the identified test meeting", async () => {
    const scratch = scratchName();
    const tenant = randomUUID();
    const migration = await migrationFor(scratch);
    await inRolledBackTx(async (sql) => {
      await createScratch(sql, scratch);
      await asTenant(sql, tenant, `
        INSERT INTO ${scratch}.meetings (id, tenant_id, title, committee_id)
          VALUES ('${randomUUID()}', '${tenant}', 'Real meeting', '${randomUUID()}');`);
      await expect(sql.unsafe(migration)).rejects.toThrow(/reference a committee that does not exist/);
    });
  });

  it("refuses a same-named constraint with a different definition instead of trusting the name", async () => {
    const scratch = scratchName();
    const migration = await migrationFor(scratch);
    await inRolledBackTx(async (sql) => {
      await createScratch(sql, scratch);
      await sql.unsafe(`ALTER TABLE ${scratch}.meetings ADD CONSTRAINT chk_meetings_status CHECK (status IS NOT NULL)`);
      await expect(sql.unsafe(migration)).rejects.toThrow(/chk_meetings_status on .* exists with a different definition/);
    });
  });

  it("the migrated meeting schema has all 17 constraints, validated", async () => {
    const cons = await constraintsOn(sqlClient, "meeting");
    expect(cons.map((c) => c.conname)).toEqual(EXPECTED);
    expect(cons.every((c) => c.convalidated)).toBe(true);
  });
});
