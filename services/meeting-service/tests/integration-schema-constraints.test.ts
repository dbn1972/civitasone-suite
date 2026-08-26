/**
 * Integration test: migrations/0001_meeting_core.sql is missing CHECK/FK constraints for the
 * core-lifecycle tables, so enum-valued columns and two foreign-key-shaped references rely
 * entirely on the application layer (Zod) for integrity.
 *
 * CORRECTNESS AUDIT FINDING (MEDIUM — missing DB-level constraints, defense-in-depth gap),
 * core-lifecycle cluster.
 *
 * Read directly from migrations/0001_meeting_core.sql:
 *   - `meeting.meetings.status`/`type`/`confidentiality_level` are plain `VARCHAR`, no CHECK,
 *     even though meeting-core/domain.ts + validators.ts both maintain closed enum vocabularies
 *     for exactly these columns (MEETING_STATES / MEETING_TYPES / CONFIDENTIALITY_LEVELS).
 *   - `meeting.meetings.committee_id` and `.series_id` are plain `UUID`, no
 *     `REFERENCES meeting.committees(id)` / `REFERENCES meeting.meeting_series(id)` — contrast
 *     `parent_meeting_id UUID REFERENCES meeting.meetings(id)` two lines above committee_id in
 *     the same table, which DOES get a real FK. Nothing stops a `meetings` row from pointing at
 *     a committee or series that doesn't exist (or from later being orphaned if one is deleted).
 *   - `meeting.participants.role`/`invitation_status`/`attendance_mode` — same gap: no CHECK.
 *   - `meeting.agenda_items.status`/`outcome_type`/`category`/`confidentiality_level` — same
 *     gap: no CHECK. `agenda_items.deferred_to` (the carry-forward successor link,
 *     self-referential) also has no FK back to `meeting.agenda_items(id)`.
 *   - `meeting.attendance_records.method`/`mode`/`status` — same gap: no CHECK.
 *
 * By contrast, `meeting.room_bookings` DOES get a real, working `EXCLUDE USING gist` constraint
 * (`room_bookings_no_overlap`) for its own core invariant — so the team clearly knows how to
 * add DB-level guards where they chose to; these enum/FK gaps look like an oversight rather
 * than a deliberate decision, especially since Zod already declares the exact same closed
 * vocabularies at the API boundary (this migration could echo them 1:1 as `CHECK (col IN (...))`).
 *
 * Today, only the HTTP/Zod boundary and hand-written command payloads enforce these
 * vocabularies. Any other write path — a migration/backfill script, a different service or
 * admin tool with DB credentials, a bug in a future consumer that forgets to validate — can
 * silently write a value Zod would have rejected, or point a meeting at a nonexistent
 * committee/series, and Postgres will not object.
 *
 * Every claim below is proven by literally performing the write the schema should (but does
 * not) reject, then reading it back successfully.
 *
 * _Cluster: meeting-core, participant, agenda, attendance (core-lifecycle audit)._
 */
import { describe, it, expect, afterAll } from "vitest";
import { randomUUID } from "node:crypto";
import { runWithTenant } from "@civitasone/db";
import { sqlClient } from "../src/shared/db.js";

const TENANT = randomUUID();
const ACTOR = randomUUID();

function tenantQuery<T>(fn: (sql: typeof sqlClient) => Promise<T>): Promise<T> {
  return runWithTenant(TENANT, () =>
    sqlClient.begin(async (sql) => {
      await sql`select set_config('app.tenant_id', ${TENANT}, true)`;
      return fn(sql as unknown as typeof sqlClient);
    }),
  ) as Promise<T>;
}

afterAll(async () => {
  await sqlClient.begin(async (sql) => {
    await sql`select set_config('app.tenant_id', ${TENANT}, true)`;
    await sql`DELETE FROM meeting.attendance_records WHERE tenant_id = ${TENANT}`;
  });
  await sqlClient.begin(async (sql) => {
    await sql`select set_config('app.tenant_id', ${TENANT}, true)`;
    await sql`DELETE FROM meeting.agenda_items WHERE tenant_id = ${TENANT}`;
  });
  await sqlClient.begin(async (sql) => {
    await sql`select set_config('app.tenant_id', ${TENANT}, true)`;
    await sql`DELETE FROM meeting.participants WHERE tenant_id = ${TENANT}`;
  });
  await sqlClient.begin(async (sql) => {
    await sql`select set_config('app.tenant_id', ${TENANT}, true)`;
    await sql`DELETE FROM meeting.meetings WHERE tenant_id = ${TENANT}`;
  });
  await sqlClient.end();
});

describe("meeting.meetings: CHECK on enum columns + FK on committee_id/series_id (fix 8)", () => {
  it("an invalid `status` (outside the 10-state vocabulary) is rejected by the database", async () => {
    const id = randomUUID();
    await expect(
      tenantQuery(
        (sql) => sql`
        INSERT INTO meeting.meetings (id, tenant_id, type, title, status, chairperson_id, secretary_id, created_by, updated_by)
        VALUES (${id}, ${TENANT}, 'committee', 'Constraint-gap fixture', 'not_a_real_status', ${randomUUID()}, ${randomUUID()}, ${ACTOR}, ${ACTOR})`,
      ),
    ).rejects.toThrow();
    const rows = await tenantQuery((sql) => sql`SELECT status FROM meeting.meetings WHERE id = ${id}`);
    // chk_meetings_status (migrations/0009) now echoes meeting-core/domain.ts's MEETING_STATES.
    expect((rows as any[]).length).toBe(0);
  });

  it("an invalid `type` and `confidentiality_level` are both rejected", async () => {
    const id = randomUUID();
    await expect(
      tenantQuery(
        (sql) => sql`
        INSERT INTO meeting.meetings (id, tenant_id, type, title, confidentiality_level, chairperson_id, secretary_id, created_by, updated_by)
        VALUES (${id}, ${TENANT}, 'not_a_real_type', 'Constraint-gap fixture 2', 'not_a_real_level', ${randomUUID()}, ${randomUUID()}, ${ACTOR}, ${ACTOR})`,
      ),
    ).rejects.toThrow();
    const rows = await tenantQuery((sql) => sql`SELECT type, confidentiality_level FROM meeting.meetings WHERE id = ${id}`);
    expect((rows as any[]).length).toBe(0);
  });

  it("committee_id pointing at a non-existent committee is rejected (fk_meetings_committee_id)", async () => {
    const id = randomUUID();
    const ghostCommitteeId = randomUUID(); // guaranteed not to exist in meeting.committees
    const committeeExists = await tenantQuery((sql) => sql`SELECT 1 AS x FROM meeting.committees WHERE id = ${ghostCommitteeId}`);
    expect((committeeExists as any[]).length).toBe(0); // confirmed: truly does not exist
    await expect(
      tenantQuery(
        (sql) => sql`
        INSERT INTO meeting.meetings (id, tenant_id, type, title, committee_id, chairperson_id, secretary_id, created_by, updated_by)
        VALUES (${id}, ${TENANT}, 'committee', 'Orphan committee_id fixture', ${ghostCommitteeId}, ${randomUUID()}, ${randomUUID()}, ${ACTOR}, ${ACTOR})`,
      ),
    ).rejects.toThrow();
    const rows = await tenantQuery((sql) => sql`SELECT committee_id FROM meeting.meetings WHERE id = ${id}`);
    expect((rows as any[]).length).toBe(0);
  });

  it("series_id pointing at a non-existent series is rejected (fk_meetings_series_id)", async () => {
    const id = randomUUID();
    const ghostSeriesId = randomUUID();
    await expect(
      tenantQuery(
        (sql) => sql`
        INSERT INTO meeting.meetings (id, tenant_id, type, title, series_id, chairperson_id, secretary_id, created_by, updated_by)
        VALUES (${id}, ${TENANT}, 'committee', 'Orphan series_id fixture', ${ghostSeriesId}, ${randomUUID()}, ${randomUUID()}, ${ACTOR}, ${ACTOR})`,
      ),
    ).rejects.toThrow();
    const rows = await tenantQuery((sql) => sql`SELECT series_id FROM meeting.meetings WHERE id = ${id}`);
    expect((rows as any[]).length).toBe(0);
  });
});

describe("meeting.participants: CHECK on role/invitation_status/attendance_mode (fix 8)", () => {
  it("an invalid role and invitation_status are both rejected", async () => {
    const meetingId = randomUUID();
    await tenantQuery(
      (sql) => sql`
      INSERT INTO meeting.meetings (id, tenant_id, type, title, chairperson_id, secretary_id, created_by, updated_by)
      VALUES (${meetingId}, ${TENANT}, 'committee', 'Participant constraint-gap fixture', ${randomUUID()}, ${randomUUID()}, ${ACTOR}, ${ACTOR})`,
    );
    const participantId = randomUUID();
    // NOTE: kept under 16 chars deliberately -- invitation_status is VARCHAR(16), and a
    // longer bogus string would be rejected by the column WIDTH, not by the semantic CHECK
    // being proven here.
    await expect(
      tenantQuery(
        (sql) => sql`
        INSERT INTO meeting.participants (id, tenant_id, meeting_id, employee_id, role, invitation_status, created_by, updated_by)
        VALUES (${participantId}, ${TENANT}, ${meetingId}, ${randomUUID()}, 'bogus_role', 'bogus', ${ACTOR}, ${ACTOR})`,
      ),
    ).rejects.toThrow();
    const rows = await tenantQuery((sql) => sql`SELECT role, invitation_status FROM meeting.participants WHERE id = ${participantId}`);
    // chk_participants_role / chk_participants_invitation_status (migrations/0009) now echo
    // participant/domain.ts's PARTICIPANT_ROLES / INVITATION_STATUSES.
    expect((rows as any[]).length).toBe(0);
  });
});

describe("meeting.agenda_items: CHECK on status/outcome_type + FK on deferred_to (fix 8)", () => {
  it("an invalid status and outcome_type are both rejected", async () => {
    const meetingId = randomUUID();
    await tenantQuery(
      (sql) => sql`
      INSERT INTO meeting.meetings (id, tenant_id, type, title, chairperson_id, secretary_id, created_by, updated_by)
      VALUES (${meetingId}, ${TENANT}, 'committee', 'Agenda constraint-gap fixture', ${randomUUID()}, ${randomUUID()}, ${ACTOR}, ${ACTOR})`,
    );
    // NOTE: bogus values kept under 16 chars deliberately -- outcome_type/status are both
    // VARCHAR(16); a longer string would hit the column WIDTH, not the semantic CHECK being
    // proven here.
    const itemId = randomUUID();
    await expect(
      tenantQuery(
        (sql) => sql`
        INSERT INTO meeting.agenda_items (id, tenant_id, meeting_id, sequence, title, outcome_type, status, created_by, updated_by)
        VALUES (${itemId}, ${TENANT}, ${meetingId}, 1, 'Bad enum fixture', 'bogus_outcome', 'bogus', ${ACTOR}, ${ACTOR})`,
      ),
    ).rejects.toThrow();
    const rows = await tenantQuery((sql) => sql`SELECT outcome_type, status FROM meeting.agenda_items WHERE id = ${itemId}`);
    expect((rows as any[]).length).toBe(0);
  });

  it("deferred_to pointing at a non-existent agenda item is rejected (fk_agenda_items_deferred_to)", async () => {
    const meetingId = randomUUID();
    await tenantQuery(
      (sql) => sql`
      INSERT INTO meeting.meetings (id, tenant_id, type, title, chairperson_id, secretary_id, created_by, updated_by)
      VALUES (${meetingId}, ${TENANT}, 'committee', 'Agenda deferred_to fixture', ${randomUUID()}, ${randomUUID()}, ${ACTOR}, ${ACTOR})`,
    );
    const itemId = randomUUID();
    const ghostItemId = randomUUID();
    await expect(
      tenantQuery(
        (sql) => sql`
        INSERT INTO meeting.agenda_items (id, tenant_id, meeting_id, sequence, title, outcome_type, status, deferred_to, created_by, updated_by)
        VALUES (${itemId}, ${TENANT}, ${meetingId}, 1, 'Orphan deferred_to fixture', 'discussion', 'deferred', ${ghostItemId}, ${ACTOR}, ${ACTOR})`,
      ),
    ).rejects.toThrow();
    const rows = await tenantQuery((sql) => sql`SELECT deferred_to FROM meeting.agenda_items WHERE id = ${itemId}`);
    expect((rows as any[]).length).toBe(0);
  });
});

describe("meeting.attendance_records: CHECK on method/mode/status (fix 8)", () => {
  it("an invalid method, mode, and status are all rejected", async () => {
    const meetingId = randomUUID();
    await tenantQuery(
      (sql) => sql`
      INSERT INTO meeting.meetings (id, tenant_id, type, title, chairperson_id, secretary_id, created_by, updated_by)
      VALUES (${meetingId}, ${TENANT}, 'committee', 'Attendance constraint-gap fixture', ${randomUUID()}, ${randomUUID()}, ${ACTOR}, ${ACTOR})`,
    );
    const participantId = randomUUID();
    await tenantQuery(
      (sql) => sql`
      INSERT INTO meeting.participants (id, tenant_id, meeting_id, employee_id, role, created_by, updated_by)
      VALUES (${participantId}, ${TENANT}, ${meetingId}, ${randomUUID()}, 'member', ${ACTOR}, ${ACTOR})`,
    );
    // NOTE: bogus values kept under 16 chars deliberately -- method/mode/status are all
    // VARCHAR(16); a longer string would hit the column WIDTH, not the semantic CHECK being
    // proven here.
    const attendanceId = randomUUID();
    await expect(
      tenantQuery(
        (sql) => sql`
        INSERT INTO meeting.attendance_records (id, tenant_id, meeting_id, participant_id, method, check_in_at, mode, status, created_by, updated_by)
        VALUES (${attendanceId}, ${TENANT}, ${meetingId}, ${participantId}, 'bogus_method', now(), 'bogus_mode', 'bogus', ${ACTOR}, ${ACTOR})`,
      ),
    ).rejects.toThrow();
    const rows = await tenantQuery(
      (sql) => sql`SELECT method, mode, status FROM meeting.attendance_records WHERE id = ${attendanceId}`,
    );
    // chk_attendance_method / chk_attendance_mode / chk_attendance_status (migrations/0009)
    // now echo attendance/domain.ts's ATTENDANCE_METHODS / ATTENDANCE_MODES / ATTENDANCE_STATUSES.
    expect((rows as any[]).length).toBe(0);
  });
});
