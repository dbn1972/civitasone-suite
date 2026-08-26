/**
 * Integration test — quorum re-check on resumption after adjournment (Gap 5).
 *
 * Proves the resume (adjourned → in_progress) transition re-evaluates quorum LIVE from the current
 * attendance set (config `quorum.recheck_on_resume`, default ON) instead of trusting the stale
 * `quorum_established` flag: a meeting that lost quorum during the break cannot silently resume.
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { randomUUID } from "node:crypto";
import { runWithTenant } from "@civitasone/db";
import type { CommandEnvelope } from "@civitasone/queue";
import type { FastifyInstance } from "fastify";
import { buildApp } from "../src/app.js";
import { sqlClient } from "../src/shared/db.js";
import { COMMANDS } from "../src/topics.js";
import { registerMeetingCoreConsumers } from "../src/modules/meeting-core/consumer.js";

const TENANT = "d4d4d4d4-4444-4000-8000-0000000000d4";
const COMMITTEE = "d3d3d3d3-4444-4000-8000-0000000000d3";
const MEETING = "d2d2d2d2-4444-4000-8000-0000000000d2";
const ACTOR = "d1d1d1d1-4444-4000-8000-0000000000d1";
const MEMBERS = [1, 2, 3, 4].map((n) => `d5d5d5d5-4444-4000-8000-00000000000${n}`);

const handlers = new Map<string, (msg: CommandEnvelope<any>) => Promise<void>>();
registerMeetingCoreConsumers((topic: string, h: any) => handlers.set(topic, h));

function msg<T>(type: string, payload: T): CommandEnvelope<T> {
  return { messageId: randomUUID(), type, tenantId: TENANT, actorId: ACTOR, correlationId: randomUUID(), schemaVersion: "1.0", payload } as CommandEnvelope<T>;
}
function run<T>(m: CommandEnvelope<T>): Promise<void> {
  return runWithTenant(TENANT, () => handlers.get(m.type)!(m)) as Promise<void>;
}
function tenantQuery<T>(fn: (sql: typeof sqlClient) => Promise<T>): Promise<T> {
  return runWithTenant(TENANT, () =>
    sqlClient.begin(async (sql) => {
      await sql`select set_config('app.tenant_id', ${TENANT}, true)`;
      return fn(sql as unknown as typeof sqlClient);
    }),
  ) as Promise<T>;
}
async function addPresentAttendee(memberId: string): Promise<void> {
  await tenantQuery(async (sql) => {
    const pid = randomUUID();
    await sql`
      insert into meeting.participants (id, tenant_id, meeting_id, employee_id, role, invitation_status, created_by, updated_by)
      values (${pid}, ${TENANT}, ${MEETING}, ${memberId}, 'member', 'accepted', ${ACTOR}, ${ACTOR})`;
    await sql`
      insert into meeting.attendance_records (id, tenant_id, meeting_id, participant_id, method, check_in_at, mode, status, created_by, updated_by)
      values (${randomUUID()}, ${TENANT}, ${MEETING}, ${pid}, 'manual', now(), 'in_person', 'present', ${ACTOR}, ${ACTOR})`;
  });
}
async function meetingStatus(): Promise<string> {
  const rows = await tenantQuery((sql) => sql`select status from meeting.meetings where id = ${MEETING}`);
  return rows[0].status as string;
}

let app: FastifyInstance;

beforeAll(async () => {
  app = await buildApp();
  await app.ready();
  await sqlClient.begin(async (sql) => {
    await sql`select set_config('app.tenant_id', ${TENANT}, true)`;
    // Order matters (fix 8: meeting.meetings.committee_id now carries a real FK to
    // meeting.committees) — delete meetings (the child) before committees (the parent).
    for (const t of ["attendance_records", "participants", "committee_members", "meeting_state_transitions", "meetings", "committees"]) {
      await sql.unsafe(`delete from meeting.${t} where tenant_id = '${TENANT}'`);
    }
    await sql`delete from _outbox.messages where tenant_id = ${TENANT}`;

    // Committee: quorum minMembers 3; 4 active members.
    await sql`
      insert into meeting.committees (id, tenant_id, name, code, type, constitution_date, quorum_rule, created_by, updated_by)
      values (${COMMITTEE}, ${TENANT}, 'Standing Committee', 'SC', 'standing', '2025-01-01',
        ${sql.json({ minMembers: 3, vcCountsForQuorum: true })}, ${ACTOR}, ${ACTOR})`;
    for (const m of MEMBERS) {
      await sql`
        insert into meeting.committee_members (id, tenant_id, committee_id, member_id, role, appointment_date, status, created_by, updated_by)
        values (${randomUUID()}, ${TENANT}, ${COMMITTEE}, ${m}, 'member', '2025-01-01', 'active', ${ACTOR}, ${ACTOR})`;
    }
    // Meeting is ADJOURNED but still carries a STALE quorum_established = true from when it started.
    // chairperson_id: ACTOR — IDOR fix (Req 1.1): handleMeetingTransition (used below to resume
    // in_progress) now requires the caller to be this meeting's own chairperson/secretary; this
    // file's writes all publish as ACTOR, so ACTOR is seeded as the chair directly.
    await sql`
      insert into meeting.meetings (id, tenant_id, type, title, status, committee_id, financial_year,
        scheduled_at, actual_start_at, quorum_established, adjournment_reason, meeting_number, chairperson_id, created_by, updated_by)
      values (${MEETING}, ${TENANT}, 'committee', 'SC sitting', 'adjourned', ${COMMITTEE}, '2025-26',
        '2025-06-15T10:00:00Z', '2025-06-15T10:05:00Z', true, 'lunch break', 'SC/2025-26/001', ${ACTOR}, ${ACTOR}, ${ACTOR})`;
  });
  // Only 2 members remain present after the break (below the quorum of 3).
  await addPresentAttendee(MEMBERS[0]);
  await addPresentAttendee(MEMBERS[1]);
});

afterAll(async () => {
  await sqlClient.begin(async (sql) => {
    await sql`select set_config('app.tenant_id', ${TENANT}, true)`;
    // Order matters (fix 8: meeting.meetings.committee_id now carries a real FK to
    // meeting.committees) — delete meetings (the child) before committees (the parent).
    for (const t of ["attendance_records", "participants", "committee_members", "meeting_state_transitions", "meetings", "committees"]) {
      await sql.unsafe(`delete from meeting.${t} where tenant_id = '${TENANT}'`);
    }
    await sql`delete from _outbox.messages where tenant_id = ${TENANT}`;
  });
  await app.close();
  await sqlClient.end();
});

describe("quorum re-check on resumption (Gap 5)", () => {
  it("REJECTS resume when live attendance (2) is below quorum (3), despite the stale flag", async () => {
    await expect(
      run(msg(COMMANDS.meetingTransition, { meetingId: MEETING, version: 1, to: "in_progress" })),
    ).rejects.toThrow(/quorum/i);
    expect(await meetingStatus()).toBe("adjourned");
  });

  it("ALLOWS resume once a third member is present again (live quorum restored)", async () => {
    await addPresentAttendee(MEMBERS[2]);
    await run(msg(COMMANDS.meetingTransition, { meetingId: MEETING, version: 1, to: "in_progress" }));
    expect(await meetingStatus()).toBe("in_progress");
  });
});
