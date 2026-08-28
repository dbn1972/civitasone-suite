/**
 * Integration test: no scheduling-conflict check exists outside room booking, and even the
 * room-booking pre-check silently ignores participant/chairperson double-booking.
 *
 * CORRECTNESS AUDIT FINDING (HIGH — missing conflict detection), core-lifecycle cluster.
 *
 * Two independent gaps, both proven live below against the real consumers + Postgres:
 *
 * 1. meeting-core has ZERO calendar awareness. `meeting-core/domain.ts#assertTransition`'s
 *    `draft -> scheduled` guard (`validateDraftToScheduled` + `validateNoticePeriod`) checks
 *    only: a chairperson is assigned, >=1 agenda item exists, the date is in the future, and
 *    the tenant's notice-period floor is met. It never queries room_bookings, other meetings'
 *    scheduled_at/duration, or any participant's calendar. Two meetings sharing the same
 *    chairperson AND the same mandatory participant, scheduled for the exact same time slot,
 *    both transition draft -> scheduled cleanly — no error, no warning, nothing surfaced.
 *
 * 2. calendar/repo.ts#checkConflicts DOES support participant-overlap detection — it accepts
 *    an optional `participantIds` and folds `gatherBusy(...)` results into
 *    `ConflictReport.participants` (repo.ts:340-376, domain.ts `detectConflicts`). But
 *    calendar/routes.ts's booking route (`POST /v1/meetings/calendar/bookings`, ~line 179) only
 *    ever calls `repo.checkConflicts(tenantId, { window, roomId })` — it NEVER passes
 *    `participantIds`, even though it has already loaded the meeting (and could trivially look
 *    up its mandatory participants). And even if the report did come back with
 *    `report.participants` populated, the route only inspects `report.room.length` before
 *    deciding whether to 409. Booking two DIFFERENT rooms for two meetings that share a
 *    mandatory participant at an overlapping time sails through with 202 for both.
 *    `bookRoomSchema` (validators.ts) doesn't even have a field to opt into the check.
 *
 * The room_bookings_no_overlap EXCLUDE constraint (migrations/0001, Req 14.3/P28) is real and
 * DOES stop the same ROOM from being double-booked — that part of Req 14.3 works. What's
 * missing is everything about PEOPLE: a chairperson or mandatory participant can be committed
 * to two simultaneous meetings with no system warning anywhere in the stack.
 *
 * _Cluster: calendar, meeting-core (core-lifecycle audit)._
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
import { registerAgendaConsumers } from "../src/modules/agenda/consumer.js";
import { registerParticipantConsumers } from "../src/modules/participant/consumer.js";
import { registerCalendarConsumers } from "../src/modules/calendar/consumer.js";
import * as calendarRepo from "../src/modules/calendar/repo.js";

const SECRET = "test_secret_for_civitasone_32chr";

const TENANT = randomUUID();
const SHARED_CHAIR = randomUUID(); // chairs BOTH meetings below
// IDOR fix (Req 1.1): meetingTransition/roomBook-adjacent writes now require the caller to be
// this meeting's own chairperson/secretary. Every meeting in this file is chaired by
// SHARED_CHAIR, so ACTOR is aliased to it (rather than a distinct identity) purely so the
// existing transition calls keep passing the new ownership check — this file isn't about
// ownership, it's about scheduling-conflict detection.
const ACTOR = SHARED_CHAIR;
const SHARED_MEMBER = randomUUID(); // a mandatory participant on BOTH meetings below
const SECRETARY = randomUUID();

const handlers = new Map<string, (msg: CommandEnvelope<any>) => Promise<void>>();
registerMeetingCoreConsumers((topic, h) => handlers.set(topic, h as any));
registerAgendaConsumers((topic, h) => handlers.set(topic, h as any));
registerParticipantConsumers((topic, h) => handlers.set(topic, h as any));
registerCalendarConsumers((topic, h) => handlers.set(topic, h as any));

function msg<T>(type: string, payload: T): CommandEnvelope<T> {
  return {
    messageId: randomUUID(),
    type,
    tenantId: TENANT,
    actorId: ACTOR,
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

/** Auth header for the calendar booking ROUTE (fix 4 is wired at the HTTP boundary). */
function writeHeaders(actorId: string, roles: string[]) {
  const token = signToken({ sub: actorId, tid: TENANT, roles, sid: `sess-${actorId}` }, SECRET, 3600);
  return { authorization: `Bearer ${token}`, "x-idempotency-key": `idem-${randomUUID()}` };
}

let app: FastifyInstance;

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
  return (rows as any[])[0];
}

async function createScheduledMeeting(opts: { title: string; scheduledAt: Date; participantEmployeeId: string }): Promise<string> {
  const meetingId = randomUUID();
  await run(
    msg(COMMANDS.meetingCreate, {
      id: meetingId,
      tenantId: TENANT,
      title: opts.title,
      type: "committee",
      scheduledAt: opts.scheduledAt.toISOString(),
      durationMinutes: 60,
      chairpersonId: SHARED_CHAIR,
      secretaryId: SECRETARY,
    }),
  );
  await run(
    msg(COMMANDS.agendaItemSubmit, {
      agendaItemId: randomUUID(),
      meetingId,
      tenantId: TENANT,
      title: "Only item",
      outcomeType: "discussion",
    }),
  );
  await run(
    msg(COMMANDS.participantAdd, {
      meetingId,
      tenantId: TENANT,
      participants: [{ id: randomUUID(), employeeId: opts.participantEmployeeId, role: "member", isMandatory: true }],
    }),
  );
  const meeting = await readMeeting(meetingId);
  await run(msg(COMMANDS.meetingTransition, { meetingId, version: meeting.version, to: "scheduled" }));
  return meetingId;
}

async function createRoom(name: string): Promise<string> {
  const roomId = randomUUID();
  await run(msg(COMMANDS.roomCreate, { roomId, tenantId: TENANT, name, capacity: 10 }));
  return roomId;
}

beforeAll(async () => {
  await sqlClient.begin(async (sql) => {
    await sql`select set_config('app.tenant_id', ${TENANT}, true)`;
    await sql`DELETE FROM meeting.room_bookings WHERE tenant_id = ${TENANT}`;
  });
  await sqlClient.begin(async (sql) => {
    await sql`select set_config('app.tenant_id', ${TENANT}, true)`;
    await sql`DELETE FROM meeting.rooms WHERE tenant_id = ${TENANT}`;
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
  app = await buildApp();
});

afterAll(async () => {
  await app.close();
  await sqlClient.end();
});

describe("meeting-core scheduling: zero conflict awareness", () => {
  it("BUG: two meetings sharing a chairperson AND a mandatory participant both schedule for the identical time slot", async () => {
    const slot = new Date(Date.now() + 10 * 86_400_000);
    slot.setUTCHours(10, 0, 0, 0);

    const meetingA = await createScheduledMeeting({
      title: "Budget Review",
      scheduledAt: slot,
      participantEmployeeId: SHARED_MEMBER,
    });
    const meetingB = await createScheduledMeeting({
      title: "Policy Review — exact same slot",
      scheduledAt: slot, // identical start time, same chairperson, same mandatory member
      participantEmployeeId: SHARED_MEMBER,
    });

    const a = await readMeeting(meetingA);
    const b = await readMeeting(meetingB);
    // Both transitions succeeded with no conflict surfaced anywhere.
    expect(a.status).toBe("scheduled");
    expect(b.status).toBe("scheduled");
    expect(new Date(a.scheduled_at).getTime()).toBe(new Date(b.scheduled_at).getTime());
    expect(a.chairperson_id).toBe(b.chairperson_id);
  });
});

describe("calendar booking route: room conflict is checked, participant conflict is now checked too (fix 4)", () => {
  it("booking two DIFFERENT rooms for overlapping meetings sharing a participant is blocked (409 CALENDAR_CONFLICT) unless acknowledged", async () => {
    const start = new Date(Date.now() + 20 * 86_400_000);
    const end = new Date(start.getTime() + 60 * 60_000);
    // Meeting Y overlaps meeting X by 30 minutes, same shared participant.
    const overlapStart = new Date(start.getTime() + 30 * 60_000);
    const overlapEnd = new Date(overlapStart.getTime() + 60 * 60_000);

    const meetingX = await createScheduledMeeting({ title: "Room-conflict fixture X", scheduledAt: start, participantEmployeeId: SHARED_MEMBER });
    const meetingY = await createScheduledMeeting({ title: "Room-conflict fixture Y", scheduledAt: overlapStart, participantEmployeeId: SHARED_MEMBER });

    const roomA = await createRoom("Committee Room A");
    const roomB = await createRoom("Committee Room B");

    // Book room A for meeting X through the REAL route (this is the code path fix 4 changes).
    const bookARes = await app.inject({
      method: "POST",
      url: "/v1/meetings/calendar/bookings",
      headers: writeHeaders(ACTOR, ["committee_secretary"]),
      payload: { meetingId: meetingX, roomId: roomA, startAt: start.toISOString(), endAt: end.toISOString() },
    });
    expect(bookARes.statusCode).toBe(202);
    await run(
      msg(COMMANDS.roomBook, {
        bookingId: bookARes.json().data.id,
        tenantId: TENANT,
        meetingId: meetingX,
        roomId: roomA,
        startAt: start.toISOString(),
        endAt: end.toISOString(),
      }),
    );

    // Book a DIFFERENT room (B) for the overlapping meeting Y, sharing SHARED_MEMBER, WITHOUT
    // passing participantIds -- the route still only checks the room by default (unchanged
    // behavior for a caller who doesn't ask for the participant check).
    const noParticipantCheckRes = await app.inject({
      method: "POST",
      url: "/v1/meetings/calendar/bookings",
      headers: writeHeaders(ACTOR, ["committee_secretary"]),
      payload: { meetingId: meetingY, roomId: roomB, startAt: overlapStart.toISOString(), endAt: overlapEnd.toISOString() },
    });
    expect(noParticipantCheckRes.statusCode).toBe(202); // different room, no participantIds requested -> still fine

    // Now request the SAME booking WITH participantIds -- fix 4 wires this through to
    // checkConflicts and surfaces a 409 CALENDAR_CONFLICT (a distinct code from
    // ROOM_DOUBLE_BOOKED) instead of silently allowing it.
    const conflictRes = await app.inject({
      method: "POST",
      url: "/v1/meetings/calendar/bookings",
      headers: writeHeaders(ACTOR, ["committee_secretary"]),
      payload: {
        meetingId: meetingY,
        roomId: roomB,
        startAt: overlapStart.toISOString(),
        endAt: overlapEnd.toISOString(),
        participantIds: [SHARED_MEMBER],
      },
    });
    expect(conflictRes.statusCode).toBe(409);
    expect(conflictRes.json().code).toBe("CALENDAR_CONFLICT");

    // Acknowledging the conflict lets the same request through (warn-with-explicit-waiver,
    // matching this service's shortNoticeWaiver precedent).
    const ackRes = await app.inject({
      method: "POST",
      url: "/v1/meetings/calendar/bookings",
      headers: writeHeaders(ACTOR, ["committee_secretary"]),
      payload: {
        meetingId: meetingY,
        roomId: roomB,
        startAt: overlapStart.toISOString(),
        endAt: overlapEnd.toISOString(),
        participantIds: [SHARED_MEMBER],
        acknowledgeConflicts: true,
      },
    });
    expect(ackRes.statusCode).toBe(202);
  });

  it("the underlying conflict machinery CAN detect this — the route now wires participantIds through to it", async () => {
    const start = new Date(Date.now() + 30 * 86_400_000);
    const end = new Date(start.getTime() + 60 * 60_000);
    const overlapStart = new Date(start.getTime() + 15 * 60_000);
    const overlapEnd = new Date(overlapStart.getTime() + 60 * 60_000);

    await createScheduledMeeting({ title: "Detectable-conflict fixture", scheduledAt: start, participantEmployeeId: SHARED_MEMBER });

    // Calling checkConflicts directly WITH participantIds (what the route would need to pass,
    // but never does) correctly surfaces the busy window.
    const report = await runWithTenant(TENANT, () =>
      calendarRepo.checkConflicts(TENANT, {
        window: { start: overlapStart, end: overlapEnd },
        participantIds: [SHARED_MEMBER],
      }),
    );
    expect(report.participants.length).toBeGreaterThan(0);
  });
});
