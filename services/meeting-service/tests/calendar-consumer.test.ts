/**
 * Calendar module — consumer integration tests (task 15.2) against the real DB.
 *
 * Exercises the calendar command handlers end-to-end against Postgres inside
 * `runWithTenant(TENANT, …)` (sets the `app.tenant_id` GUC for RLS, exactly as the worker does
 * via `withTenantConsumer`).
 *
 * Focus (per task 15.2):
 *   • room.create      — INSERT a room row + emit room.created
 *   • room.book        — INSERT a confirmed booking + emit room.booked; idempotent on redelivery (P30)
 *   • room.book (dup)  — an overlapping confirmed booking is a permanent (DLQ) ROOM_DOUBLE_BOOKED
 *                        rejection and inserts nothing (Req 14.3, P28)
 *   • room.book_cancel — flips to cancelled + fans out participant notifications (Req 14.8)
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { randomUUID } from "node:crypto";
import { runWithTenant } from "@civitasone/db";
import { NonRetryableError, type CommandEnvelope } from "@civitasone/queue";
import { NOTIFICATION_SEND } from "@civitasone/events";
import { sqlClient } from "../src/shared/db.js";
import { COMMANDS, EVENTS } from "../src/topics.js";
import { registerCalendarConsumers } from "../src/modules/calendar/consumer.js";

const TENANT = "a7a7a7a7-0000-4000-8000-0000000014e2";
const ACTOR = "90000000-0000-4000-8000-0000000014e2";
const MEETING = "b7b7b7b7-0000-4000-8000-0000000014e2";
const ROOM = "c7c7c7c7-0000-4000-8000-0000000014e2";
const EMP_A = "d1111111-0000-4000-8000-0000000014e2";
const EMP_B = "d2222222-0000-4000-8000-0000000014e2";

const BUSY_FROM = "2031-03-01T09:00:00.000Z";
const BUSY_TO = "2031-03-01T10:00:00.000Z";
const OVERLAP_FROM = "2031-03-01T09:30:00.000Z";
const OVERLAP_TO = "2031-03-01T10:30:00.000Z";
const FREE_FROM = "2031-03-01T11:00:00.000Z";
const FREE_TO = "2031-03-01T12:00:00.000Z";

const handlers = new Map<string, (msg: CommandEnvelope<any>) => Promise<void>>();
registerCalendarConsumers((topic, h) => handlers.set(topic, h as any));

function msg<T>(type: string, payload: T, messageId = randomUUID()): CommandEnvelope<T> {
  return { messageId, type, tenantId: TENANT, actorId: ACTOR, correlationId: randomUUID(), schemaVersion: "1.0", payload } as CommandEnvelope<T>;
}

function run<T>(m: CommandEnvelope<T>): Promise<void> {
  const handler = handlers.get(m.type);
  if (!handler) throw new Error(`no handler for ${m.type}`);
  return runWithTenant(TENANT, () => handler(m)) as Promise<void>;
}

async function bookingRow(id: string): Promise<any | null> {
  return runWithTenant(TENANT, async () => {
    const rows = await sqlClient.begin(async (sql) => {
      await sql`select set_config('app.tenant_id', ${TENANT}, true)`;
      return sql`select id, status, version from meeting.room_bookings where id = ${id}`;
    });
    return rows[0] ?? null;
  });
}

async function confirmedCount(): Promise<number> {
  const rows = await runWithTenant(TENANT, () =>
    sqlClient.begin(async (sql) => {
      await sql`select set_config('app.tenant_id', ${TENANT}, true)`;
      return sql`select count(*)::int as n from meeting.room_bookings
                 where tenant_id = ${TENANT} and room_id = ${ROOM} and status = 'confirmed'`;
    }),
  );
  return rows[0].n as number;
}

async function outboxCount(topic: string): Promise<number> {
  const rows = await runWithTenant(TENANT, () =>
    sqlClient.begin(async (sql) => {
      await sql`select set_config('app.tenant_id', ${TENANT}, true)`;
      return sql`select count(*)::int as n from _outbox.messages where tenant_id = ${TENANT} and topic = ${topic}`;
    }),
  );
  return rows[0].n as number;
}

beforeAll(async () => {
  await sqlClient.begin(async (sql) => {
    await sql`select set_config('app.tenant_id', ${TENANT}, true)`;
    await sql`
      insert into meeting.meetings (id, tenant_id, type, title, status, scheduled_at, duration_minutes, created_by, updated_by)
      values (${MEETING}, ${TENANT}, 'committee', 'Calendar Consumer', 'scheduled', ${BUSY_FROM}, 60, ${ACTOR}, ${ACTOR})
      on conflict (id) do nothing`;
    await sql`
      insert into meeting.participants (id, tenant_id, meeting_id, employee_id, role, created_by, updated_by)
      values (${randomUUID()}, ${TENANT}, ${MEETING}, ${EMP_A}, 'chairperson', ${ACTOR}, ${ACTOR}),
             (${randomUUID()}, ${TENANT}, ${MEETING}, ${EMP_B}, 'member', ${ACTOR}, ${ACTOR})
      on conflict (id) do nothing`;
  });
});

afterAll(async () => {
  await sqlClient.begin(async (sql) => {
    await sql`select set_config('app.tenant_id', ${TENANT}, true)`;
    await sql`delete from meeting.room_bookings where tenant_id = ${TENANT}`;
    await sql`delete from meeting.rooms where tenant_id = ${TENANT}`;
    await sql`delete from meeting.participants where meeting_id = ${MEETING}`;
    await sql`delete from meeting.meetings where id = ${MEETING}`;
    await sql`delete from _outbox.messages where tenant_id = ${TENANT}`;
  });
  await sqlClient.end();
});

describe("room.create", () => {
  it("inserts a room row and emits room.created", async () => {
    const before = await outboxCount(EVENTS.roomCreated);
    await run(msg(COMMANDS.roomCreate, { roomId: ROOM, tenantId: TENANT, name: "Consumer Room", capacity: 15, status: "active" }));
    const rows = await runWithTenant(TENANT, () =>
      sqlClient.begin(async (sql) => {
        await sql`select set_config('app.tenant_id', ${TENANT}, true)`;
        return sql`select id, name, capacity, status from meeting.rooms where id = ${ROOM}`;
      }),
    );
    expect(rows[0]).toBeTruthy();
    expect(rows[0].capacity).toBe(15);
    expect(await outboxCount(EVENTS.roomCreated)).toBe(before + 1);
  });
});

describe("room.update", () => {
  it("applies an optimistic-locked patch and emits room.updated", async () => {
    const before = await outboxCount(EVENTS.roomUpdated);
    await run(msg(COMMANDS.roomUpdate, { roomId: ROOM, tenantId: TENANT, version: 1, patch: { capacity: 30, status: "maintenance" } }));
    const rows = await runWithTenant(TENANT, () =>
      sqlClient.begin(async (sql) => {
        await sql`select set_config('app.tenant_id', ${TENANT}, true)`;
        return sql`select capacity, status, version from meeting.rooms where id = ${ROOM}`;
      }),
    );
    expect(rows[0].capacity).toBe(30);
    expect(rows[0].status).toBe("maintenance");
    expect(rows[0].version).toBe(2);
    expect(await outboxCount(EVENTS.roomUpdated)).toBe(before + 1);
    // Restore the room to active so the booking tests below can reserve it.
    await run(msg(COMMANDS.roomUpdate, { roomId: ROOM, tenantId: TENANT, version: 2, patch: { status: "active" } }));
  });

  it("rejects updating an unknown room (permanent → DLQ)", async () => {
    await expect(
      run(msg(COMMANDS.roomUpdate, { roomId: randomUUID(), tenantId: TENANT, version: 1, patch: { capacity: 5 } })),
    ).rejects.toBeInstanceOf(NonRetryableError);
  });
});

describe("room.book", () => {
  it("inserts a confirmed booking, emits room.booked, and is idempotent on redelivery (P30)", async () => {
    const bookingId = randomUUID();
    const before = await outboxCount(EVENTS.roomBooked);
    const m = msg(COMMANDS.roomBook, { bookingId, tenantId: TENANT, meetingId: MEETING, roomId: ROOM, startAt: BUSY_FROM, endAt: BUSY_TO });

    await run(m);
    const row = await bookingRow(bookingId);
    expect(row).toBeTruthy();
    expect(row.status).toBe("confirmed");
    expect(await outboxCount(EVENTS.roomBooked)).toBe(before + 1);

    // Redelivery with the SAME messageId is a no-op (markProcessed skip) — still one booked event.
    await run(m);
    expect(await outboxCount(EVENTS.roomBooked)).toBe(before + 1);
  });

  it("rejects an overlapping confirmed booking as a permanent ROOM_DOUBLE_BOOKED error (P28)", async () => {
    const dupId = randomUUID();
    const countBefore = await confirmedCount();
    await expect(
      run(msg(COMMANDS.roomBook, { bookingId: dupId, tenantId: TENANT, meetingId: MEETING, roomId: ROOM, startAt: OVERLAP_FROM, endAt: OVERLAP_TO })),
    ).rejects.toBeInstanceOf(NonRetryableError);
    // Nothing inserted for the rejected booking.
    expect(await bookingRow(dupId)).toBeNull();
    expect(await confirmedCount()).toBe(countBefore);
  });

  it("accepts a booking clear of the existing window", async () => {
    const bookingId = randomUUID();
    await run(msg(COMMANDS.roomBook, { bookingId, tenantId: TENANT, meetingId: MEETING, roomId: ROOM, startAt: FREE_FROM, endAt: FREE_TO }));
    expect((await bookingRow(bookingId)).status).toBe("confirmed");
  });

  it("rejects a booking for an unknown meeting (permanent → DLQ)", async () => {
    await expect(
      run(msg(COMMANDS.roomBook, { bookingId: randomUUID(), tenantId: TENANT, meetingId: randomUUID(), roomId: ROOM, startAt: FREE_FROM, endAt: FREE_TO })),
    ).rejects.toBeInstanceOf(NonRetryableError);
  });
});

describe("room.book_cancel", () => {
  it("flips the booking to cancelled and fans out participant notifications (Req 14.8)", async () => {
    // Book first, then cancel.
    const bookingId = randomUUID();
    await run(msg(COMMANDS.roomBook, { bookingId, tenantId: TENANT, meetingId: MEETING, roomId: ROOM, startAt: "2031-04-01T09:00:00.000Z", endAt: "2031-04-01T10:00:00.000Z" }));

    const notifyBefore = await outboxCount(NOTIFICATION_SEND);
    const cancelledBefore = await outboxCount(EVENTS.roomBookingCancelled);
    await run(msg(COMMANDS.roomBookCancel, { bookingId, tenantId: TENANT, version: 1, reason: "moved online" }));

    expect((await bookingRow(bookingId)).status).toBe("cancelled");
    // One notification per meeting participant (2 seeded) + the domain cancellation event.
    expect(await outboxCount(NOTIFICATION_SEND)).toBe(notifyBefore + 2);
    expect(await outboxCount(EVENTS.roomBookingCancelled)).toBe(cancelledBefore + 1);
  });

  it("rejects cancelling an unknown booking (permanent → DLQ)", async () => {
    await expect(
      run(msg(COMMANDS.roomBookCancel, { bookingId: randomUUID(), tenantId: TENANT, version: 1 })),
    ).rejects.toBeInstanceOf(NonRetryableError);
  });
});
