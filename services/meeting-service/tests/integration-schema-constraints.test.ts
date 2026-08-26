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

describe("meeting.meetings: no CHECK on enum columns, no FK on committee_id/series_id", () => {
  it("BUG: an invalid `status` (outside the 10-state vocabulary) is accepted by the database", async () => {
    const id = randomUUID();
    await tenantQuery(
      (sql) => sql`
      INSERT INTO meeting.meetings (id, tenant_id, type, title, status, chairperson_id, secretary_id, created_by, updated_by)
      VALUES (${id}, ${TENANT}, 'committee', 'Constraint-gap fixture', 'not_a_real_status', ${randomUUID()}, ${randomUUID()}, ${ACTOR}, ${ACTOR})`,
    );
    const rows = await tenantQuery((sql) => sql`SELECT status FROM meeting.meetings WHERE id = ${id}`);
    // meeting-core/domain.ts's MEETING_STATES (draft|scheduled|agenda_locked|in_progress|
    // adjourned|minutes_pending|minutes_approved|closed|archived|cancelled) would reject this
    // at the Zod/domain layer -- the database happily stored it.
    expect((rows as any[])[0].status).toBe("not_a_real_status");
  });

  it("BUG: an invalid `type` and `confidentiality_level` are both accepted", async () => {
    const id = randomUUID();
    await tenantQuery(
      (sql) => sql`
      INSERT INTO meeting.meetings (id, tenant_id, type, title, confidentiality_level, chairperson_id, secretary_id, created_by, updated_by)
      VALUES (${id}, ${TENANT}, 'not_a_real_type', 'Constraint-gap fixture 2', 'not_a_real_level', ${randomUUID()}, ${randomUUID()}, ${ACTOR}, ${ACTOR})`,
    );
    const rows = await tenantQuery((sql) => sql`SELECT type, confidentiality_level FROM meeting.meetings WHERE id = ${id}`);
    expect((rows as any[])[0].type).toBe("not_a_real_type");
    expect((rows as any[])[0].confidentiality_level).toBe("not_a_real_level");
  });

  it("BUG: committee_id pointing at a non-existent committee is accepted (no FK)", async () => {
    const id = randomUUID();
    const ghostCommitteeId = randomUUID(); // guaranteed not to exist in meeting.committees
    await tenantQuery(
      (sql) => sql`
      INSERT INTO meeting.meetings (id, tenant_id, type, title, committee_id, chairperson_id, secretary_id, created_by, updated_by)
      VALUES (${id}, ${TENANT}, 'committee', 'Orphan committee_id fixture', ${ghostCommitteeId}, ${randomUUID()}, ${randomUUID()}, ${ACTOR}, ${ACTOR})`,
    );
    const rows = await tenantQuery((sql) => sql`SELECT committee_id FROM meeting.meetings WHERE id = ${id}`);
    expect((rows as any[])[0].committee_id).toBe(ghostCommitteeId);
    const committeeExists = await tenantQuery((sql) => sql`SELECT 1 AS x FROM meeting.committees WHERE id = ${ghostCommitteeId}`);
    expect((committeeExists as any[]).length).toBe(0); // confirmed: truly does not exist
  });

  it("BUG: series_id pointing at a non-existent series is accepted (no FK)", async () => {
    const id = randomUUID();
    const ghostSeriesId = randomUUID();
    await tenantQuery(
      (sql) => sql`
      INSERT INTO meeting.meetings (id, tenant_id, type, title, series_id, chairperson_id, secretary_id, created_by, updated_by)
      VALUES (${id}, ${TENANT}, 'committee', 'Orphan series_id fixture', ${ghostSeriesId}, ${randomUUID()}, ${randomUUID()}, ${ACTOR}, ${ACTOR})`,
    );
    const rows = await tenantQuery((sql) => sql`SELECT series_id FROM meeting.meetings WHERE id = ${id}`);
    expect((rows as any[])[0].series_id).toBe(ghostSeriesId);
  });
});

describe("meeting.participants: no CHECK on role/invitation_status/attendance_mode", () => {
  it("BUG: an invalid role and invitation_status are both accepted", async () => {
    const meetingId = randomUUID();
    await tenantQuery(
      (sql) => sql`
      INSERT INTO meeting.meetings (id, tenant_id, type, title, chairperson_id, secretary_id, created_by, updated_by)
      VALUES (${meetingId}, ${TENANT}, 'committee', 'Participant constraint-gap fixture', ${randomUUID()}, ${randomUUID()}, ${ACTOR}, ${ACTOR})`,
    );
    const participantId = randomUUID();
    // NOTE: kept under 16 chars deliberately -- invitation_status is VARCHAR(16), and a
    // longer bogus string would be rejected by the column WIDTH, not by any semantic CHECK.
    // The point being proven is the absence of an enum CHECK, so the fixture must stay short
    // enough to isolate that from the incidental width limit.
    await tenantQuery(
      (sql) => sql`
      INSERT INTO meeting.participants (id, tenant_id, meeting_id, employee_id, role, invitation_status, created_by, updated_by)
      VALUES (${participantId}, ${TENANT}, ${meetingId}, ${randomUUID()}, 'bogus_role', 'bogus', ${ACTOR}, ${ACTOR})`,
    );
    const rows = await tenantQuery((sql) => sql`SELECT role, invitation_status FROM meeting.participants WHERE id = ${participantId}`);
    // participant/domain.ts PARTICIPANT_ROLES / INVITATION_STATUSES would reject both values.
    expect((rows as any[])[0].role).toBe("bogus_role");
    expect((rows as any[])[0].invitation_status).toBe("bogus");
  });
});

describe("meeting.agenda_items: no CHECK on status/outcome_type, no FK on deferred_to", () => {
  it("BUG: an invalid status and outcome_type are both accepted", async () => {
    const meetingId = randomUUID();
    await tenantQuery(
      (sql) => sql`
      INSERT INTO meeting.meetings (id, tenant_id, type, title, chairperson_id, secretary_id, created_by, updated_by)
      VALUES (${meetingId}, ${TENANT}, 'committee', 'Agenda constraint-gap fixture', ${randomUUID()}, ${randomUUID()}, ${ACTOR}, ${ACTOR})`,
    );
    // NOTE: bogus values kept under 16 chars deliberately -- outcome_type/status are both
    // VARCHAR(16); a longer string would hit the column WIDTH, not a semantic CHECK, which
    // would muddy the point (absence of an enum CHECK) being proven here.
    const itemId = randomUUID();
    await tenantQuery(
      (sql) => sql`
      INSERT INTO meeting.agenda_items (id, tenant_id, meeting_id, sequence, title, outcome_type, status, created_by, updated_by)
      VALUES (${itemId}, ${TENANT}, ${meetingId}, 1, 'Bad enum fixture', 'bogus_outcome', 'bogus', ${ACTOR}, ${ACTOR})`,
    );
    const rows = await tenantQuery((sql) => sql`SELECT outcome_type, status FROM meeting.agenda_items WHERE id = ${itemId}`);
    expect((rows as any[])[0].outcome_type).toBe("bogus_outcome");
    expect((rows as any[])[0].status).toBe("bogus");
  });

  it("BUG: deferred_to pointing at a non-existent agenda item is accepted (no self-referential FK)", async () => {
    const meetingId = randomUUID();
    await tenantQuery(
      (sql) => sql`
      INSERT INTO meeting.meetings (id, tenant_id, type, title, chairperson_id, secretary_id, created_by, updated_by)
      VALUES (${meetingId}, ${TENANT}, 'committee', 'Agenda deferred_to fixture', ${randomUUID()}, ${randomUUID()}, ${ACTOR}, ${ACTOR})`,
    );
    const itemId = randomUUID();
    const ghostItemId = randomUUID();
    await tenantQuery(
      (sql) => sql`
      INSERT INTO meeting.agenda_items (id, tenant_id, meeting_id, sequence, title, outcome_type, status, deferred_to, created_by, updated_by)
      VALUES (${itemId}, ${TENANT}, ${meetingId}, 1, 'Orphan deferred_to fixture', 'discussion', 'deferred', ${ghostItemId}, ${ACTOR}, ${ACTOR})`,
    );
    const rows = await tenantQuery((sql) => sql`SELECT deferred_to FROM meeting.agenda_items WHERE id = ${itemId}`);
    expect((rows as any[])[0].deferred_to).toBe(ghostItemId);
  });
});

describe("meeting.attendance_records: no CHECK on method/mode/status", () => {
  it("BUG: an invalid method, mode, and status are all accepted", async () => {
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
    // VARCHAR(16); a longer string would hit the column WIDTH, not a semantic CHECK, which
    // would muddy the point (absence of an enum CHECK) being proven here.
    const attendanceId = randomUUID();
    await tenantQuery(
      (sql) => sql`
      INSERT INTO meeting.attendance_records (id, tenant_id, meeting_id, participant_id, method, check_in_at, mode, status, created_by, updated_by)
      VALUES (${attendanceId}, ${TENANT}, ${meetingId}, ${participantId}, 'bogus_method', now(), 'bogus_mode', 'bogus', ${ACTOR}, ${ACTOR})`,
    );
    const rows = await tenantQuery(
      (sql) => sql`SELECT method, mode, status FROM meeting.attendance_records WHERE id = ${attendanceId}`,
    );
    // attendance/domain.ts ATTENDANCE_METHODS / ATTENDANCE_MODES / ATTENDANCE_STATUSES would
    // reject all three values -- the database stored them without complaint.
    expect((rows as any[])[0].method).toBe("bogus_method");
    expect((rows as any[])[0].mode).toBe("bogus_mode");
    expect((rows as any[])[0].status).toBe("bogus");
  });
});
