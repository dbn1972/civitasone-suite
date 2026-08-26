/**
 * Integration test: cross-actor IDOR across meeting-core, participant, and attendance.
 *
 * SECURITY AUDIT FINDING (CRITICAL — cross-actor IDOR, CWE-639), core-lifecycle cluster.
 *
 * Every write route in this cluster (meeting-core/routes.ts, participant/routes.ts,
 * attendance/routes.ts) authorizes with `requireRole(ctx, SOME_ROLE_GROUP)` only. None of
 * them — nor the command publishers, nor the consumers that perform the actual write —
 * ever compare the caller's identity (`ctx.actorId` / `msg.actorId`) to the resource's
 * owning identity:
 *   - meeting-core: never compares the caller to `meeting.chairpersonId` / `secretaryId`.
 *   - participant: never compares the caller to the target participant's `employeeId`,
 *     despite participant/routes.ts's own doc comment stating the intended model —
 *     "Respond (RSVP) / nominate — the invited member acts on their own invitation".
 *   - attendance: `assertParticipantInvited` (attendance/domain.ts) checks only that the
 *     given `participantId` is an invited member of the meeting — never that the CALLER is
 *     that participant.
 *
 * Confirmed by exhaustive static search: `grep -rn "actorId ===" src/modules/{meeting-core,
 * agenda,participant,attendance,calendar}/` and the `!==` / `employeeId ===` variants all
 * return zero matches across every file in all 5 core-lifecycle modules. `actorId` is used
 * ONLY to stamp `createdBy`/`updatedBy` audit columns, never as an authorization input.
 *
 * Practical impact demonstrated below:
 *   1. Any `committee_secretary`, anywhere in the tenant, can edit — and re-assign the
 *      chairperson of — a meeting they have no staffing relationship to.
 *   2. Any `committee_chairperson`, anywhere in the tenant, can drive the state machine
 *      (schedule, cancel, ...) of a meeting they do not chair.
 *   3. Any `committee_member` can RSVP-decline or nominate a proxy on behalf of a
 *      completely different participant, silently, without that participant's knowledge.
 *   4. Any `committee_member` can mark ANY OTHER invited participant "present" via
 *      check-in/manual-mark — including participants they have no relationship to beyond
 *      sharing a meeting — which is sufficient, on its own, to fabricate quorum: this test
 *      shows a single unrelated actor single-handedly flips `quorum_established` to true by
 *      "checking in" two other people who never actually attended.
 *
 * Verified live via the real consumer + real Postgres (this file), matching the visitor-
 * service audit's identity-verify-ownership.integration.test.ts methodology and the local
 * integration-lifecycle.test.ts harness conventions (app.inject for the route boundary,
 * direct handler invocation via runWithTenant for the write side, direct DB reads to verify).
 *
 * _Cluster: meeting-core, participant, attendance (core-lifecycle audit)._
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { randomUUID } from "node:crypto";
import { signToken } from "@civitasone/auth";
import { runWithTenant } from "@civitasone/db";
import type { CommandEnvelope } from "@civitasone/queue";
import type { FastifyInstance } from "fastify";
import { buildApp } from "../src/app.js";
import { sqlClient } from "../src/shared/db.js";
import { COMMANDS } from "../src/topics.js";
import { registerMeetingCoreConsumers } from "../src/modules/meeting-core/consumer.js";
import { registerParticipantConsumers } from "../src/modules/participant/consumer.js";
import { registerAttendanceConsumers } from "../src/modules/attendance/consumer.js";
import { registerAgendaConsumers } from "../src/modules/agenda/consumer.js";

const SECRET = "test_secret_for_civitasone_32chr";
const TENANT = randomUUID();
const COMMITTEE = randomUUID();

// The meeting's REAL owners — the people the meeting is actually staffed by.
const OWNER_CHAIR = randomUUID();
const OWNER_SECRETARY = randomUUID();
// A victim participant with no relationship to any of the attackers below.
const VICTIM_A = randomUUID();
const VICTIM_B = randomUUID();
// Attackers: authenticated, hold a broad role, but have ZERO relationship to the specific
// meeting/participant they act on (not its chairperson/secretary, not the invitee).
const ATTACKER_SECRETARY = randomUUID();
const ATTACKER_CHAIR = randomUUID();
const ATTACKER_MEMBER = randomUUID();

const handlers = new Map<string, (msg: CommandEnvelope<any>) => Promise<void>>();
registerMeetingCoreConsumers((topic, h) => handlers.set(topic, h as any));
registerParticipantConsumers((topic, h) => handlers.set(topic, h as any));
registerAttendanceConsumers((topic, h) => handlers.set(topic, h as any));
registerAgendaConsumers((topic, h) => handlers.set(topic, h as any));

function token(actorId: string, roles: string[]): string {
  return signToken({ sub: actorId, tid: TENANT, roles, sid: `sess-${actorId}` }, SECRET, 3600);
}

function writeHeaders(actorId: string, roles: string[]) {
  return {
    authorization: `Bearer ${token(actorId, roles)}`,
    "x-idempotency-key": `idem-${randomUUID()}`,
  };
}

/** Build a CommandEnvelope with an explicit `actorId` (the attacker's identity, not a fixed constant). */
function msg<T>(type: string, actorId: string, payload: T): CommandEnvelope<T> {
  return {
    messageId: randomUUID(),
    type,
    tenantId: TENANT,
    actorId,
    correlationId: randomUUID(),
    schemaVersion: "1.0",
    payload,
  } as CommandEnvelope<T>;
}

function run<T>(m: CommandEnvelope<T>): Promise<void> {
  const handler = handlers.get(m.type);
  if (!handler) throw new Error(`no handler for ${m.type}`);
  return runWithTenant(TENANT, () => handler(m)) as Promise<void>;
}

function tenantQuery<T>(fn: (sql: typeof sqlClient) => Promise<T>): Promise<T> {
  return runWithTenant(TENANT, () =>
    sqlClient.begin(async (sql) => {
      await sql`select set_config('app.tenant_id', ${TENANT}, true)`;
      return fn(sql as unknown as typeof sqlClient);
    }),
  ) as Promise<T>;
}

async function readMeeting(id: string) {
  const rows = await tenantQuery((sql) => sql`SELECT * FROM meeting.meetings WHERE id = ${id} AND tenant_id = ${TENANT}`);
  return (rows as any[])[0] ?? null;
}

async function readParticipant(id: string) {
  const rows = await tenantQuery((sql) => sql`SELECT * FROM meeting.participants WHERE id = ${id} AND tenant_id = ${TENANT}`);
  return (rows as any[])[0] ?? null;
}

async function createMeeting(opts: {
  chairpersonId: string;
  secretaryId: string;
  scheduledAt: Date;
  committeeId?: string;
}): Promise<string> {
  const id = randomUUID();
  await run(
    msg(COMMANDS.meetingCreate, OWNER_SECRETARY, {
      id,
      tenantId: TENANT,
      title: "Ownership-gap fixture meeting",
      type: "committee",
      scheduledAt: opts.scheduledAt.toISOString(),
      durationMinutes: 60,
      chairpersonId: opts.chairpersonId,
      secretaryId: opts.secretaryId,
      ...(opts.committeeId ? { committeeId: opts.committeeId } : {}),
    }),
  );
  return id;
}

async function addAgendaItem(meetingId: string): Promise<void> {
  await run(
    msg(COMMANDS.agendaItemSubmit, OWNER_SECRETARY, {
      agendaItemId: randomUUID(),
      meetingId,
      tenantId: TENANT,
      title: "Only item",
      outcomeType: "discussion",
    }),
  );
}

async function addParticipant(meetingId: string, participantId: string, employeeId: string): Promise<void> {
  await run(
    msg(COMMANDS.participantAdd, OWNER_SECRETARY, {
      meetingId,
      tenantId: TENANT,
      participants: [{ id: participantId, employeeId, role: "member", isMandatory: true }],
    }),
  );
}

let app: FastifyInstance;

beforeAll(async () => {
  await sqlClient.begin(async (sql) => {
    await sql`select set_config('app.tenant_id', ${TENANT}, true)`;
    await sql`DELETE FROM meeting.attendance_records WHERE tenant_id = ${TENANT}`;
  });
  await sqlClient.begin(async (sql) => {
    await sql`select set_config('app.tenant_id', ${TENANT}, true)`;
    await sql`DELETE FROM meeting.participants WHERE tenant_id = ${TENANT}`;
  });
  await sqlClient.begin(async (sql) => {
    await sql`select set_config('app.tenant_id', ${TENANT}, true)`;
    await sql`DELETE FROM meeting.agenda_items WHERE tenant_id = ${TENANT}`;
  });
  await sqlClient.begin(async (sql) => {
    await sql`select set_config('app.tenant_id', ${TENANT}, true)`;
    await sql`DELETE FROM meeting.meeting_state_transitions WHERE tenant_id = ${TENANT}`;
  });
  await sqlClient.begin(async (sql) => {
    await sql`select set_config('app.tenant_id', ${TENANT}, true)`;
    await sql`DELETE FROM meeting.meetings WHERE tenant_id = ${TENANT}`;
  });
  await sqlClient.begin(async (sql) => {
    await sql`select set_config('app.tenant_id', ${TENANT}, true)`;
    await sql`DELETE FROM meeting.committee_members WHERE tenant_id = ${TENANT}`;
  });
  await sqlClient.begin(async (sql) => {
    await sql`select set_config('app.tenant_id', ${TENANT}, true)`;
    await sql`DELETE FROM meeting.committees WHERE tenant_id = ${TENANT}`;
  });

  // Committee + a 2-member quorum rule, used only by the attendance/quorum-gaming test.
  await sqlClient.begin(async (sql) => {
    await sql`select set_config('app.tenant_id', ${TENANT}, true)`;
    await sql`
    INSERT INTO meeting.committees (id, tenant_id, name, code, type, constitution_date, quorum_rule, voting_rule, created_by, updated_by)
    VALUES (${COMMITTEE}, ${TENANT}, 'Ownership Gap Test Committee', 'OGC', 'standing', '2025-01-01',
            ${JSON.stringify({ minMembers: 2 })}::jsonb, 'simple_majority', ${OWNER_SECRETARY}, ${OWNER_SECRETARY})`;
  });
  for (const m of [
    { memberId: OWNER_CHAIR, role: "chairperson" },
    { memberId: VICTIM_A, role: "member" },
    { memberId: VICTIM_B, role: "member" },
  ]) {
    await sqlClient.begin(async (sql) => {
      await sql`select set_config('app.tenant_id', ${TENANT}, true)`;
      await sql`
      INSERT INTO meeting.committee_members (id, tenant_id, committee_id, member_id, role, appointment_date, status, voting_right, created_by, updated_by)
      VALUES (${randomUUID()}, ${TENANT}, ${COMMITTEE}, ${m.memberId}, ${m.role}, '2025-01-01', 'active', true, ${OWNER_SECRETARY}, ${OWNER_SECRETARY})`;
    });
  }

  app = await buildApp();
});

afterAll(async () => {
  await app.close();
  await sqlClient.end();
});

describe("meeting-core: no ownership check on update/transition/cancel (IDOR)", () => {
  it("PATCH /v1/meetings/:id — an unrelated committee_secretary can edit AND reassign a meeting they do not staff", async () => {
    const meetingId = await createMeeting({
      chairpersonId: OWNER_CHAIR,
      secretaryId: OWNER_SECRETARY,
      scheduledAt: new Date(Date.now() + 14 * 86_400_000),
    });
    const before = await readMeeting(meetingId);
    expect(before.secretary_id).toBe(OWNER_SECRETARY);

    // ATTACKER_SECRETARY has never been added to this meeting or its committee in any role.
    // The route only checks `requireRole(ctx, WRITE_ROLES)` — holding *a* committee_secretary
    // role anywhere in the tenant is sufficient.
    const res = await app.inject({
      method: "PATCH",
      url: `/v1/meetings/${meetingId}`,
      headers: writeHeaders(ATTACKER_SECRETARY, ["committee_secretary"]),
      payload: {
        version: before.version,
        patch: {
          title: "Retitled by a stranger",
          secretaryId: ATTACKER_SECRETARY, // the attacker hijacks ownership going forward
        },
      },
    });
    // NOT 403 — this is the bug: role-only check passes for a complete stranger to this meeting.
    expect(res.statusCode).toBe(202);

    await run(
      msg(COMMANDS.meetingUpdate, ATTACKER_SECRETARY, {
        meetingId,
        version: before.version,
        patch: { title: "Retitled by a stranger", secretaryId: ATTACKER_SECRETARY },
      }),
    );

    const after = await readMeeting(meetingId);
    // BUG: a stranger's write took effect, including reassigning secretaryId to themselves.
    expect(after.title).toBe("Retitled by a stranger");
    expect(after.secretary_id).toBe(ATTACKER_SECRETARY);
    expect(after.updated_by).toBe(ATTACKER_SECRETARY);
  });

  it("transition + cancel — an unrelated committee_chairperson can schedule then cancel a meeting they do not chair", async () => {
    const meetingId = await createMeeting({
      chairpersonId: OWNER_CHAIR,
      secretaryId: OWNER_SECRETARY,
      scheduledAt: new Date(Date.now() + 14 * 86_400_000),
    });
    await addAgendaItem(meetingId); // prerequisite for draft -> scheduled; not itself the attack

    let meeting = await readMeeting(meetingId);
    expect(meeting.status).toBe("draft");

    // ATTACKER_CHAIR is a committee_chairperson somewhere in the tenant, but not of THIS
    // meeting's committee, and is not `meeting.chairperson_id`.
    const scheduleRes = await app.inject({
      method: "POST",
      url: `/v1/meetings/${meetingId}/transition`,
      headers: writeHeaders(ATTACKER_CHAIR, ["committee_chairperson"]),
      payload: { version: meeting.version, to: "scheduled" },
    });
    expect(scheduleRes.statusCode).toBe(202); // NOT 403

    await run(msg(COMMANDS.meetingTransition, ATTACKER_CHAIR, { meetingId, version: meeting.version, to: "scheduled" }));
    meeting = await readMeeting(meetingId);
    expect(meeting.status).toBe("scheduled");

    // Same stranger now cancels the meeting outright.
    const cancelRes = await app.inject({
      method: "DELETE",
      url: `/v1/meetings/${meetingId}`,
      headers: writeHeaders(ATTACKER_CHAIR, ["committee_chairperson"]),
      payload: { version: meeting.version, reason: "cancelled by a stranger" },
    });
    expect(cancelRes.statusCode).toBe(202); // NOT 403

    await run(
      msg(COMMANDS.meetingCancel, ATTACKER_CHAIR, {
        meetingId,
        version: meeting.version,
        reason: "cancelled by a stranger",
      }),
    );
    meeting = await readMeeting(meetingId);
    // BUG: a non-chairperson, non-staffed actor drove the entire state machine, including the
    // irreversible cancel.
    expect(meeting.status).toBe("cancelled");

    const transitions = await tenantQuery(
      (sql) => sql`SELECT actor_id, to_state FROM meeting.meeting_state_transitions
                   WHERE meeting_id = ${meetingId} AND tenant_id = ${TENANT} ORDER BY transitioned_at ASC`,
    );
    expect((transitions as any[]).every((t) => t.actor_id === ATTACKER_CHAIR)).toBe(true);
  });
});

describe("participant: RSVP/nominate ignore the documented 'act on your own invitation' model (IDOR)", () => {
  it("respond — an unrelated committee_member can decline on a stranger's behalf, without their knowledge", async () => {
    const meetingId = await createMeeting({
      chairpersonId: OWNER_CHAIR,
      secretaryId: OWNER_SECRETARY,
      scheduledAt: new Date(Date.now() + 14 * 86_400_000),
    });
    const participantId = randomUUID();
    await addParticipant(meetingId, participantId, VICTIM_A);

    const before = await readParticipant(participantId);
    expect(before.invitation_status).toBe("pending");

    // ATTACKER_MEMBER is a committee_member somewhere in the tenant, but is not VICTIM_A and
    // has no relationship to this participant row. participant/routes.ts's own doc comment
    // says RSVP is "the invited member act[ing] on their own invitation" — the route never
    // checks that.
    const res = await app.inject({
      method: "POST",
      url: `/v1/meetings/${meetingId}/participants/${participantId}/respond`,
      headers: writeHeaders(ATTACKER_MEMBER, ["committee_member"]),
      payload: { response: "decline", declineReason: "forged decline by an unrelated actor" },
    });
    expect(res.statusCode).toBe(202); // NOT 403

    await run(
      msg(COMMANDS.participantRespond, ATTACKER_MEMBER, {
        meetingId,
        participantId,
        response: "decline",
        declineReason: "forged decline by an unrelated actor",
      }),
    );

    const after = await readParticipant(participantId);
    // BUG: VICTIM_A's invitation was declined by someone who is not VICTIM_A — VICTIM_A never
    // made this choice and may not even know it happened.
    expect(after.invitation_status).toBe("declined");
    expect(after.decline_reason).toBe("forged decline by an unrelated actor");
    expect(after.updated_by).toBe(ATTACKER_MEMBER);
  });

  it("nominate — an unrelated committee_member can designate a proxy on a stranger's behalf", async () => {
    // committeeId is set here (unlike the other fixtures) because handleParticipantNominate
    // resolves the approved-nominee list from the meeting's committee roster — VICTIM_B
    // qualifies as the nominee only because it was seeded as an active member of COMMITTEE.
    const meetingId = await createMeeting({
      chairpersonId: OWNER_CHAIR,
      secretaryId: OWNER_SECRETARY,
      scheduledAt: new Date(Date.now() + 14 * 86_400_000),
      committeeId: COMMITTEE,
    });
    const participantId = randomUUID();
    await addParticipant(meetingId, participantId, VICTIM_A);

    const res = await app.inject({
      method: "POST",
      url: `/v1/meetings/${meetingId}/participants/${participantId}/nominate`,
      headers: writeHeaders(ATTACKER_MEMBER, ["committee_member"]),
      payload: { nomineeId: VICTIM_B, reason: "forged nomination by an unrelated actor" },
    });
    expect(res.statusCode).toBe(202); // NOT 403

    await run(
      msg(COMMANDS.participantNominate, ATTACKER_MEMBER, {
        meetingId,
        participantId,
        nomineeId: VICTIM_B,
        reason: "forged nomination by an unrelated actor",
      }),
    );

    const after = await readParticipant(participantId);
    // BUG: VICTIM_A now has a proxy (VICTIM_B) attending in their place, designated entirely
    // by ATTACKER_MEMBER — VICTIM_A had no say in who represents them.
    expect(after.nominee_id).toBe(VICTIM_B);
    expect(after.updated_by).toBe(ATTACKER_MEMBER);
  });
});

describe("attendance: check-in has no self/identity check — quorum can be fabricated (IDOR)", () => {
  it("a single unrelated actor checks in two other participants and single-handedly establishes quorum", async () => {
    const meetingId = await createMeeting({
      chairpersonId: OWNER_CHAIR,
      secretaryId: OWNER_SECRETARY,
      scheduledAt: new Date(Date.now() + 60_000), // near-future; committee requires minMembers: 2
    });
    // Route through the committee so quorum evaluation has a rule + roster to check against.
    await tenantQuery(
      (sql) => sql`UPDATE meeting.meetings SET committee_id = ${COMMITTEE} WHERE id = ${meetingId} AND tenant_id = ${TENANT}`,
    );

    const participantA = randomUUID();
    const participantB = randomUUID();
    await addParticipant(meetingId, participantA, VICTIM_A);
    await addParticipant(meetingId, participantB, VICTIM_B);

    let meeting = await readMeeting(meetingId);
    expect(meeting.quorum_established).toBe(false);

    // ATTACKER_MEMBER holds CHECKIN_ROLES (committee_member) but is not VICTIM_A, not
    // VICTIM_B, and has no relationship to either participant row. attendance/domain.ts's
    // assertParticipantInvited only checks that the *target* participantId is an invited
    // member of *this meeting* — it never checks who is making the HTTP call.
    const res1 = await app.inject({
      method: "POST",
      url: `/v1/meetings/${meetingId}/attendance/check-in`,
      headers: writeHeaders(ATTACKER_MEMBER, ["committee_member"]),
      payload: { participantId: participantA, method: "manual", mode: "in_person" },
    });
    expect(res1.statusCode).toBe(202); // NOT 403, NOT "you may only check yourself in"

    const now = new Date().toISOString();
    await run(
      msg(COMMANDS.attendanceCheckIn, ATTACKER_MEMBER, {
        attendanceId: randomUUID(),
        meetingId,
        tenantId: TENANT,
        participantId: participantA,
        method: "manual",
        mode: "in_person",
        checkInAt: now,
      }),
    );

    const res2 = await app.inject({
      method: "POST",
      url: `/v1/meetings/${meetingId}/attendance/check-in`,
      headers: writeHeaders(ATTACKER_MEMBER, ["committee_member"]),
      payload: { participantId: participantB, method: "manual", mode: "in_person" },
    });
    expect(res2.statusCode).toBe(202);

    await run(
      msg(COMMANDS.attendanceCheckIn, ATTACKER_MEMBER, {
        attendanceId: randomUUID(),
        meetingId,
        tenantId: TENANT,
        participantId: participantB,
        method: "manual",
        mode: "in_person",
        checkInAt: now,
      }),
    );

    // BUG: neither VICTIM_A nor VICTIM_B ever called the API themselves — a single unrelated
    // actor "checked in" both of them from one HTTP identity — yet the meeting now reads as
    // quorate, which downstream governance modules (voting, decision) treat as trustworthy.
    meeting = await readMeeting(meetingId);
    expect(meeting.quorum_established).toBe(true);

    const records = await tenantQuery(
      (sql) => sql`SELECT participant_id, created_by, status FROM meeting.attendance_records
                   WHERE meeting_id = ${meetingId} AND tenant_id = ${TENANT} ORDER BY created_at ASC`,
    );
    expect((records as any[]).length).toBe(2);
    expect((records as any[]).every((r) => r.created_by === ATTACKER_MEMBER)).toBe(true);
    expect((records as any[]).every((r) => r.status === "present")).toBe(true);
  }, 15000);
});
