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
 *   4. [FIXED — see the third describe block below] Attendance check-in/manual-mark used to
 *      have no identity check at all: any `committee_member` could mark ANY OTHER invited
 *      participant "present" — including participants they had no relationship to beyond
 *      sharing a meeting — which was sufficient, on its own, to fabricate quorum.
 *      `attendance/domain.ts#assertParticipantInvited` now also verifies the caller is either
 *      the participant themselves or an authorized agent of the meeting (its secretary,
 *      chairperson, or creator — the roll-call case); an unrelated actor's check-in is accepted
 *      at the HTTP boundary (202, CQRS) but rejected by the consumer, so no attendance record is
 *      persisted and quorum is never fabricated.
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
import { NonRetryableError, type CommandEnvelope } from "@civitasone/queue";
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
  it("PATCH /v1/meetings/:id — an unrelated committee_secretary is rejected (403) and cannot edit or reassign a meeting they do not staff", async () => {
    const meetingId = await createMeeting({
      chairpersonId: OWNER_CHAIR,
      secretaryId: OWNER_SECRETARY,
      scheduledAt: new Date(Date.now() + 14 * 86_400_000),
    });
    const before = await readMeeting(meetingId);
    expect(before.secretary_id).toBe(OWNER_SECRETARY);

    // ATTACKER_SECRETARY has never been added to this meeting or its committee in any role.
    // Fix: the route now compares the caller to meeting.chairpersonId/secretaryId (or committee
    // standing) — holding *a* committee_secretary role anywhere in the tenant is no longer
    // sufficient.
    const res = await app.inject({
      method: "PATCH",
      url: `/v1/meetings/${meetingId}`,
      headers: writeHeaders(ATTACKER_SECRETARY, ["committee_secretary"]),
      payload: {
        version: before.version,
        patch: {
          title: "Retitled by a stranger",
          secretaryId: ATTACKER_SECRETARY, // the attacker attempts to hijack ownership
        },
      },
    });
    expect(res.statusCode).toBe(403);

    // Defense in depth: even a direct-to-consumer write (bypassing the route entirely) is
    // independently rejected.
    await expect(
      run(
        msg(COMMANDS.meetingUpdate, ATTACKER_SECRETARY, {
          meetingId,
          version: before.version,
          patch: { title: "Retitled by a stranger", secretaryId: ATTACKER_SECRETARY },
        }),
      ),
    ).rejects.toThrow();

    const after = await readMeeting(meetingId);
    // The stranger's write never took effect at either layer.
    expect(after.title).toBe(before.title);
    expect(after.secretary_id).toBe(OWNER_SECRETARY);
    expect(after.updated_by).toBe(OWNER_SECRETARY);

    // Positive path: the meeting's OWN secretary can still legitimately edit it.
    const ownRes = await app.inject({
      method: "PATCH",
      url: `/v1/meetings/${meetingId}`,
      headers: writeHeaders(OWNER_SECRETARY, ["committee_secretary"]),
      payload: { version: before.version, patch: { title: "Retitled by its own secretary" } },
    });
    expect(ownRes.statusCode).toBe(202);
    await run(
      msg(COMMANDS.meetingUpdate, OWNER_SECRETARY, {
        meetingId,
        version: before.version,
        patch: { title: "Retitled by its own secretary" },
      }),
    );
    const afterOwn = await readMeeting(meetingId);
    expect(afterOwn.title).toBe("Retitled by its own secretary");
  });

  it("transition + cancel — an unrelated committee_chairperson is rejected (403) and cannot drive a meeting they do not chair", async () => {
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
    expect(scheduleRes.statusCode).toBe(403);
    await expect(
      run(msg(COMMANDS.meetingTransition, ATTACKER_CHAIR, { meetingId, version: meeting.version, to: "scheduled" })),
    ).rejects.toThrow();
    meeting = await readMeeting(meetingId);
    expect(meeting.status).toBe("draft"); // unchanged

    // Same stranger attempts to cancel the meeting outright — also rejected.
    const cancelRes = await app.inject({
      method: "DELETE",
      url: `/v1/meetings/${meetingId}`,
      headers: writeHeaders(ATTACKER_CHAIR, ["committee_chairperson"]),
      payload: { version: meeting.version, reason: "cancelled by a stranger" },
    });
    expect(cancelRes.statusCode).toBe(403);
    await expect(
      run(msg(COMMANDS.meetingCancel, ATTACKER_CHAIR, { meetingId, version: meeting.version, reason: "cancelled by a stranger" })),
    ).rejects.toThrow();
    meeting = await readMeeting(meetingId);
    expect(meeting.status).toBe("draft"); // still unchanged — no transition ever recorded

    const transitions = await tenantQuery(
      (sql) => sql`SELECT actor_id, to_state FROM meeting.meeting_state_transitions
                   WHERE meeting_id = ${meetingId} AND tenant_id = ${TENANT} ORDER BY transitioned_at ASC`,
    );
    expect((transitions as any[]).length).toBe(0);

    // Positive path: the meeting's OWN chairperson can still legitimately drive it.
    const ownRes = await app.inject({
      method: "POST",
      url: `/v1/meetings/${meetingId}/transition`,
      headers: writeHeaders(OWNER_CHAIR, ["committee_chairperson"]),
      payload: { version: meeting.version, to: "scheduled" },
    });
    expect(ownRes.statusCode).toBe(202);
    await run(msg(COMMANDS.meetingTransition, OWNER_CHAIR, { meetingId, version: meeting.version, to: "scheduled" }));
    meeting = await readMeeting(meetingId);
    expect(meeting.status).toBe("scheduled");
  });
});

describe("participant: RSVP/nominate ignore the documented 'act on your own invitation' model (IDOR)", () => {
  it("respond — an unrelated committee_member is rejected (403) and cannot decline on a stranger's behalf", async () => {
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
    // has no relationship to this participant row. Fix: the route now requires the caller to
    // BE VICTIM_A (self) or hold on-behalf-of standing (secretariat/chair/admin) — a plain
    // committee_member no longer passes for a stranger's invitation.
    const res = await app.inject({
      method: "POST",
      url: `/v1/meetings/${meetingId}/participants/${participantId}/respond`,
      headers: writeHeaders(ATTACKER_MEMBER, ["committee_member"]),
      payload: { response: "decline", declineReason: "forged decline by an unrelated actor" },
    });
    expect(res.statusCode).toBe(403);

    await expect(
      run(
        msg(COMMANDS.participantRespond, ATTACKER_MEMBER, {
          meetingId,
          participantId,
          response: "decline",
          declineReason: "forged decline by an unrelated actor",
        }),
      ),
    ).rejects.toThrow();

    const after = await readParticipant(participantId);
    // VICTIM_A's invitation was never touched by the stranger.
    expect(after.invitation_status).toBe("pending");
    expect(after.decline_reason).toBeNull();

    // Positive path: VICTIM_A (the invitee) can respond to their own invitation.
    const ownRes = await app.inject({
      method: "POST",
      url: `/v1/meetings/${meetingId}/participants/${participantId}/respond`,
      headers: writeHeaders(VICTIM_A, ["committee_member"]),
      payload: { response: "accept" },
    });
    expect(ownRes.statusCode).toBe(202);
    await run(msg(COMMANDS.participantRespond, VICTIM_A, { meetingId, participantId, response: "accept" }));
    const afterOwn = await readParticipant(participantId);
    expect(afterOwn.invitation_status).toBe("accepted");
  });

  it("nominate — an unrelated committee_member is rejected (403) and cannot designate a proxy on a stranger's behalf", async () => {
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
    expect(res.statusCode).toBe(403);

    await expect(
      run(
        msg(COMMANDS.participantNominate, ATTACKER_MEMBER, {
          meetingId,
          participantId,
          nomineeId: VICTIM_B,
          reason: "forged nomination by an unrelated actor",
        }),
      ),
    ).rejects.toThrow();

    const after = await readParticipant(participantId);
    // VICTIM_A was never assigned a proxy by the stranger.
    expect(after.nominee_id).toBeNull();

    // Positive path: VICTIM_A (the invitee) can nominate their own proxy.
    const ownRes = await app.inject({
      method: "POST",
      url: `/v1/meetings/${meetingId}/participants/${participantId}/nominate`,
      headers: writeHeaders(VICTIM_A, ["committee_member"]),
      payload: { nomineeId: VICTIM_B, reason: "on official tour" },
    });
    expect(ownRes.statusCode).toBe(202);
    await run(msg(COMMANDS.participantNominate, VICTIM_A, { meetingId, participantId, nomineeId: VICTIM_B, reason: "on official tour" }));
    const afterOwn = await readParticipant(participantId);
    expect(afterOwn.nominee_id).toBe(VICTIM_B);
  });
});

describe("attendance: check-in now has a self/identity check — quorum can no longer be fabricated by a stranger (Req 6.2)", () => {
  it("a single unrelated actor's check-in of two other participants is accepted at the HTTP boundary (202, CQRS) but rejected by the consumer — no records, no fabricated quorum", async () => {
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
    // VICTIM_B, is not this meeting's secretary/chairperson/creator (OWNER_SECRETARY /
    // OWNER_CHAIR), and has no relationship to either participant row.
    //
    // The route still accepts the write at 202 (CQRS: routes never reject a domain-rule
    // violation synchronously, they just queue the command) — the actual authorization decision
    // is made by attendance/domain.ts#assertParticipantInvited inside the consumer, so the
    // corresponding `run()` call below rejects instead of persisting anything.
    const res1 = await app.inject({
      method: "POST",
      url: `/v1/meetings/${meetingId}/attendance/check-in`,
      headers: writeHeaders(ATTACKER_MEMBER, ["committee_member"]),
      payload: { participantId: participantA, method: "manual", mode: "in_person" },
    });
    expect(res1.statusCode).toBe(202);

    const now = new Date().toISOString();
    await expect(
      run(
        msg(COMMANDS.attendanceCheckIn, ATTACKER_MEMBER, {
          attendanceId: randomUUID(),
          meetingId,
          tenantId: TENANT,
          participantId: participantA,
          method: "manual",
          mode: "in_person",
          checkInAt: now,
        }),
      ),
    ).rejects.toBeInstanceOf(NonRetryableError);

    const res2 = await app.inject({
      method: "POST",
      url: `/v1/meetings/${meetingId}/attendance/check-in`,
      headers: writeHeaders(ATTACKER_MEMBER, ["committee_member"]),
      payload: { participantId: participantB, method: "manual", mode: "in_person" },
    });
    expect(res2.statusCode).toBe(202);

    await expect(
      run(
        msg(COMMANDS.attendanceCheckIn, ATTACKER_MEMBER, {
          attendanceId: randomUUID(),
          meetingId,
          tenantId: TENANT,
          participantId: participantB,
          method: "manual",
          mode: "in_person",
          checkInAt: now,
        }),
      ),
    ).rejects.toBeInstanceOf(NonRetryableError);

    // FIXED: neither VICTIM_A nor VICTIM_B ever called the API themselves, and ATTACKER_MEMBER
    // is not authorized to act for either of them — no attendance record was persisted, and the
    // meeting does NOT read as quorate.
    meeting = await readMeeting(meetingId);
    expect(meeting.quorum_established).toBe(false);

    const records = await tenantQuery(
      (sql) => sql`SELECT participant_id, created_by, status FROM meeting.attendance_records
                   WHERE meeting_id = ${meetingId} AND tenant_id = ${TENANT} ORDER BY created_at ASC`,
    );
    expect((records as any[]).length).toBe(0);
  }, 15000);

  it("the meeting's own secretary CAN check in another participant on their behalf (roll call)", async () => {
    const meetingId = await createMeeting({
      chairpersonId: OWNER_CHAIR,
      secretaryId: OWNER_SECRETARY,
      scheduledAt: new Date(Date.now() + 60_000),
    });
    await tenantQuery(
      (sql) => sql`UPDATE meeting.meetings SET committee_id = ${COMMITTEE} WHERE id = ${meetingId} AND tenant_id = ${TENANT}`,
    );
    const participantA = randomUUID();
    await addParticipant(meetingId, participantA, VICTIM_A);

    // OWNER_SECRETARY is THIS meeting's named secretary — a legitimate roll-call check-in.
    await run(
      msg(COMMANDS.attendanceCheckIn, OWNER_SECRETARY, {
        attendanceId: randomUUID(),
        meetingId,
        tenantId: TENANT,
        participantId: participantA,
        method: "manual",
        mode: "in_person",
        checkInAt: new Date().toISOString(),
      }),
    );

    const records = await tenantQuery(
      (sql) => sql`SELECT participant_id, created_by, status FROM meeting.attendance_records
                   WHERE meeting_id = ${meetingId} AND tenant_id = ${TENANT}`,
    );
    expect((records as any[]).length).toBe(1);
    expect((records as any[])[0].created_by).toBe(OWNER_SECRETARY);
    expect((records as any[])[0].status).toBe("present");
  });
});
