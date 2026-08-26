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
import { runWithTenant } from "@civitasone/db";
import type { CommandEnvelope } from "@civitasone/queue";
import { sqlClient } from "../src/shared/db.js";
import { COMMANDS } from "../src/topics.js";
import { registerMeetingCoreConsumers } from "../src/modules/meeting-core/consumer.js";
import { registerAgendaConsumers } from "../src/modules/agenda/consumer.js";
import { registerParticipantConsumers } from "../src/modules/participant/consumer.js";
import { registerCalendarConsumers } from "../src/modules/calendar/consumer.js";
import * as calendarRepo from "../src/modules/calendar/repo.js";

const TENANT = randomUUID();
const ACTOR = randomUUID();
const SHARED_CHAIR = randomUUID(); // chairs BOTH meetings below
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
});

afterAll(async () => {
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

describe("calendar booking route: room conflict is checked, participant conflict is not", () => {
  it("BUG: booking two DIFFERENT rooms for overlapping meetings sharing a participant produces no conflict", async () => {
    const start = new Date(Date.now() + 20 * 86_400_000);
    const end = new Date(start.getTime() + 60 * 60_000);
    // Meeting Y overlaps meeting X by 30 minutes, same shared participant.
    const overlapStart = new Date(start.getTime() + 30 * 60_000);
    const overlapEnd = new Date(overlapStart.getTime() + 60 * 60_000);

    const meetingX = await createScheduledMeeting({ title: "Room-conflict fixture X", scheduledAt: start, participantEmployeeId: SHARED_MEMBER });
    const meetingY = await createScheduledMeeting({ title: "Room-conflict fixture Y", scheduledAt: overlapStart, participantEmployeeId: SHARED_MEMBER });

    const roomA = await createRoom("Committee Room A");
    const roomB = await createRoom("Committee Room B");

    const bookingA = randomUUID();
    await run(msg(COMMANDS.roomBook, { bookingId: bookingA, tenantId: TENANT, meetingId: meetingX, roomId: roomA, startAt: start.toISOString(), endAt: end.toISOString() }));

    // The route-level pre-check as actually implemented: window + roomId only, no participantIds.
    // checkConflicts reads via scopedRead (db.transaction), which sources the RLS `app.tenant_id`
    // GUC from AsyncLocalStorage (shared/db.ts) -- exactly like a real request's tenant-tx hook --
    // so this must run inside runWithTenant or a FORCE-RLS table fails closed to zero rows.
    const report = await runWithTenant(TENANT, () =>
      calendarRepo.checkConflicts(TENANT, { window: { start: overlapStart, end: overlapEnd }, roomId: roomB }),
    );
    expect(report.room.length).toBe(0); // different room -> route would return 202, not 409

    const bookingB = randomUUID();
    await run(msg(COMMANDS.roomBook, { bookingId: bookingB, tenantId: TENANT, meetingId: meetingY, roomId: roomB, startAt: overlapStart.toISOString(), endAt: overlapEnd.toISOString() }));

    const bookings = await tenantQuery(
      (sql) => sql`SELECT meeting_id, room_id, status FROM meeting.room_bookings WHERE tenant_id = ${TENANT} AND id IN (${bookingA}, ${bookingB})`,
    );
    expect((bookings as any[]).length).toBe(2);
    expect((bookings as any[]).every((b) => b.status === "confirmed")).toBe(true);
    // SHARED_MEMBER is now double-booked across meetingX and meetingY for an overlapping
    // 30-minute window, in two different rooms, and the system recorded both bookings as
    // confirmed with no conflict raised at any layer.
  });

  it("the underlying conflict machinery CAN detect this — it is simply never wired to participantIds by the route", async () => {
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
