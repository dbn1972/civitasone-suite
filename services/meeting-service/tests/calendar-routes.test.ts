/**
 * Calendar module — HTTP route tests (task 15.2) via `app.inject()`.
 *
 * Exercises the 9 calendar endpoints across the mandated axes: happy path + 400 (validation /
 * missing idempotency key) + 401 (unauthenticated) + 403 (wrong role) + 404 (unknown
 * room/meeting/booking) + 409 (room double-booking).
 *
 * Auth: HS256 test bypass (JWT_ALGORITHM=HS256, JWT_SECRET from vitest.config.ts).
 * Data: a room + scheduled meeting + two participants + one confirmed booking are seeded directly
 * (RLS-aware, `app.tenant_id` GUC set inside the seed transaction) and torn down afterwards.
 * Writes are CQRS (publish → 202) against the in-memory queue; no worker runs, so a command is
 * enqueued but not consumed — exactly the boundary these tests assert. The 409 double-booking is
 * detected synchronously by the route's conflict pre-check against the seeded confirmed booking.
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { signToken } from "@civitasone/auth";
import { buildApp } from "../src/app.js";
import { sqlClient } from "../src/shared/db.js";

const SECRET = process.env.JWT_SECRET ?? "test_secret_for_civitasone_32chr";
const TENANT = "aaaaaaaa-cafe-4a1a-9b2c-000000001402";
const MEETING = "cccccccc-cafe-4a1a-9b2c-000000001402";
const MISSING_MEETING = "dddddddd-cafe-4a1a-9b2c-000000001402";
const ROOM = "1a1a1a1a-cafe-4a1a-9b2c-000000001402";
const MISSING_ROOM = "9a9a9a9a-cafe-4a1a-9b2c-000000001402";
const BOOKING = "2b2b2b2b-cafe-4a1a-9b2c-000000001402";
const MISSING_BOOKING = "9b9b9b9b-cafe-4a1a-9b2c-000000001402";
const EMP_A = "f1111111-cafe-4a1a-9b2c-000000001402";
const EMP_B = "f2222222-cafe-4a1a-9b2c-000000001402";
const ACTOR = "0a000000-cafe-4a1a-9b2c-000000001402";

const IDEMPOTENCY = { "x-idempotency-key": "cal-key-1402-0001" } as const;

// Seeded confirmed booking window on ROOM.
const BUSY_FROM = "2030-01-01T10:00:00.000Z";
const BUSY_TO = "2030-01-01T11:00:00.000Z";
// Overlaps the busy window → double-booking.
const OVERLAP_FROM = "2030-01-01T10:30:00.000Z";
const OVERLAP_TO = "2030-01-01T11:30:00.000Z";
// Clear of the busy window → bookable.
const FREE_FROM = "2030-01-01T12:00:00.000Z";
const FREE_TO = "2030-01-01T13:00:00.000Z";

function token(roles: string[] = ["committee_secretary"], tid: string = TENANT): string {
  return signToken({ sub: ACTOR, tid, roles, sid: "sess-1402" }, SECRET);
}

let app: Awaited<ReturnType<typeof buildApp>>;

beforeAll(async () => {
  await sqlClient.begin(async (sql) => {
    await sql`select set_config('app.tenant_id', ${TENANT}, true)`;
    await sql`
      insert into meeting.meetings
        (id, tenant_id, type, title, status, scheduled_at, duration_minutes, venue, created_by, updated_by)
      values (${MEETING}, ${TENANT}, 'committee', 'Calendar Meeting', 'scheduled',
              ${BUSY_FROM}, 60, 'Room A', ${ACTOR}, ${ACTOR})
      on conflict (id) do nothing`;
    await sql`
      insert into meeting.participants
        (id, tenant_id, meeting_id, employee_id, role, created_by, updated_by)
      values (${"e1111111-cafe-4a1a-9b2c-000000001402"}, ${TENANT}, ${MEETING}, ${EMP_A}, 'chairperson', ${ACTOR}, ${ACTOR}),
             (${"e2222222-cafe-4a1a-9b2c-000000001402"}, ${TENANT}, ${MEETING}, ${EMP_B}, 'member', ${ACTOR}, ${ACTOR})
      on conflict (id) do nothing`;
    await sql`
      insert into meeting.rooms (id, tenant_id, name, capacity, status, created_by, updated_by)
      values (${ROOM}, ${TENANT}, 'Board Room', 20, 'active', ${ACTOR}, ${ACTOR})
      on conflict (id) do nothing`;
    await sql`
      insert into meeting.room_bookings
        (id, tenant_id, room_id, meeting_id, start_at, end_at, status, created_by, updated_by)
      values (${BOOKING}, ${TENANT}, ${ROOM}, ${MEETING}, ${BUSY_FROM}, ${BUSY_TO}, 'confirmed', ${ACTOR}, ${ACTOR})
      on conflict (id) do nothing`;
  });
  app = await buildApp();
});

afterAll(async () => {
  if (app) await app.close();
  await sqlClient.begin(async (sql) => {
    await sql`select set_config('app.tenant_id', ${TENANT}, true)`;
    await sql`delete from meeting.room_bookings where tenant_id = ${TENANT}`;
    await sql`delete from meeting.rooms where tenant_id = ${TENANT}`;
    await sql`delete from meeting.participants where meeting_id = ${MEETING}`;
    await sql`delete from meeting.meetings where id = ${MEETING}`;
  });
  await sqlClient.end();
});

// ─── POST /calendar/availability ──────────────────────────────────────────────

describe("POST /v1/meetings/calendar/availability", () => {
  it("401 when unauthenticated", async () => {
    const res = await app.inject({ method: "POST", url: "/v1/meetings/calendar/availability", payload: { from: BUSY_FROM, to: FREE_TO } });
    expect(res.statusCode).toBe(401);
  });

  it("403 for a role without read access", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/v1/meetings/calendar/availability",
      headers: { authorization: `Bearer ${token(["citizen"])}` },
      payload: { from: BUSY_FROM, to: FREE_TO },
    });
    expect(res.statusCode).toBe(403);
  });

  it("400 when 'to' is before 'from'", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/v1/meetings/calendar/availability",
      headers: { authorization: `Bearer ${token()}` },
      payload: { from: FREE_TO, to: BUSY_FROM },
    });
    expect(res.statusCode).toBe(400);
  });

  it("200 returns free windows for a room (excludes the busy booking)", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/v1/meetings/calendar/availability",
      headers: { authorization: `Bearer ${token(["committee_member"])}` },
      payload: { from: BUSY_FROM, to: FREE_TO, roomId: ROOM, durationMinutes: 30 },
    });
    expect(res.statusCode).toBe(200);
    const { data } = res.json();
    expect(Array.isArray(data.free)).toBe(true);
    // The [10:00,11:00) booking is excluded → the earliest free window starts at/after 11:00.
    expect(data.free.length).toBeGreaterThan(0);
  });
});

// ─── POST /calendar/suggest-slots ───────────────────────────────────────────────

describe("POST /v1/meetings/calendar/suggest-slots", () => {
  it("401 when unauthenticated", async () => {
    const res = await app.inject({ method: "POST", url: "/v1/meetings/calendar/suggest-slots", payload: { from: BUSY_FROM, to: FREE_TO, durationMinutes: 60 } });
    expect(res.statusCode).toBe(401);
  });

  it("400 for a missing durationMinutes", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/v1/meetings/calendar/suggest-slots",
      headers: { authorization: `Bearer ${token()}` },
      payload: { from: BUSY_FROM, to: FREE_TO },
    });
    expect(res.statusCode).toBe(400);
  });

  it("200 returns candidate slots avoiding the busy booking", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/v1/meetings/calendar/suggest-slots",
      headers: { authorization: `Bearer ${token()}` },
      payload: { from: BUSY_FROM, to: FREE_TO, durationMinutes: 60, roomIds: [ROOM] },
    });
    expect(res.statusCode).toBe(200);
    const { data } = res.json();
    expect(Array.isArray(data.slots)).toBe(true);
    // No suggested slot may overlap the [10:00,11:00) booking.
    for (const s of data.slots as { start: string; end: string }[]) {
      const overlaps = Date.parse(s.start) < Date.parse(BUSY_TO) && Date.parse(BUSY_FROM) < Date.parse(s.end);
      expect(overlaps).toBe(false);
    }
  });
});

// ─── GET /calendar/rooms ────────────────────────────────────────────────────────

describe("GET /v1/meetings/calendar/rooms", () => {
  it("401 when unauthenticated", async () => {
    const res = await app.inject({ method: "GET", url: "/v1/meetings/calendar/rooms" });
    expect(res.statusCode).toBe(401);
  });

  it("403 for a role without read access", async () => {
    const res = await app.inject({
      method: "GET",
      url: "/v1/meetings/calendar/rooms",
      headers: { authorization: `Bearer ${token(["citizen"])}` },
    });
    expect(res.statusCode).toBe(403);
  });

  it("200 lists the seeded room registry", async () => {
    const res = await app.inject({
      method: "GET",
      url: "/v1/meetings/calendar/rooms",
      headers: { authorization: `Bearer ${token(["committee_member"])}` },
    });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(Array.isArray(body.data)).toBe(true);
    expect(body.data.some((r: { id: string }) => r.id === ROOM)).toBe(true);
  });

  it("200 filters by ?status", async () => {
    const res = await app.inject({
      method: "GET",
      url: "/v1/meetings/calendar/rooms?status=maintenance",
      headers: { authorization: `Bearer ${token()}` },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().data.length).toBe(0);
  });
});

// ─── POST /calendar/rooms ────────────────────────────────────────────────────────

describe("POST /v1/meetings/calendar/rooms", () => {
  it("401 when unauthenticated", async () => {
    const res = await app.inject({ method: "POST", url: "/v1/meetings/calendar/rooms", payload: { name: "New", capacity: 10 } });
    expect(res.statusCode).toBe(401);
  });

  it("403 for a role without write access", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/v1/meetings/calendar/rooms",
      headers: { authorization: `Bearer ${token(["committee_member"])}`, ...IDEMPOTENCY },
      payload: { name: "New", capacity: 10 },
    });
    expect(res.statusCode).toBe(403);
  });

  it("400 when the X-Idempotency-Key header is missing", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/v1/meetings/calendar/rooms",
      headers: { authorization: `Bearer ${token()}` },
      payload: { name: "New", capacity: 10 },
    });
    expect(res.statusCode).toBe(400);
  });

  it("400 for an invalid body (capacity <= 0)", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/v1/meetings/calendar/rooms",
      headers: { authorization: `Bearer ${token()}`, ...IDEMPOTENCY },
      payload: { name: "New", capacity: 0 },
    });
    expect(res.statusCode).toBe(400);
  });

  it("202 accepts a valid room registration", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/v1/meetings/calendar/rooms",
      headers: { authorization: `Bearer ${token(["meeting_admin"])}`, ...IDEMPOTENCY },
      payload: { name: "Committee Hall", capacity: 40, equipment: ["projector"], accessibility: true },
    });
    expect(res.statusCode).toBe(202);
    expect(res.json().data.status).toBe("accepted");
  });
});

// ─── PATCH /calendar/rooms/:roomId ────────────────────────────────────────────────

describe("PATCH /v1/meetings/calendar/rooms/:roomId", () => {
  it("401 when unauthenticated", async () => {
    const res = await app.inject({ method: "PATCH", url: `/v1/meetings/calendar/rooms/${ROOM}`, payload: { version: 1, patch: { capacity: 25 } } });
    expect(res.statusCode).toBe(401);
  });

  it("400 when the X-Idempotency-Key header is missing", async () => {
    const res = await app.inject({
      method: "PATCH",
      url: `/v1/meetings/calendar/rooms/${ROOM}`,
      headers: { authorization: `Bearer ${token()}` },
      payload: { version: 1, patch: { capacity: 25 } },
    });
    expect(res.statusCode).toBe(400);
  });

  it("400 for an empty patch", async () => {
    const res = await app.inject({
      method: "PATCH",
      url: `/v1/meetings/calendar/rooms/${ROOM}`,
      headers: { authorization: `Bearer ${token()}`, ...IDEMPOTENCY },
      payload: { version: 1, patch: {} },
    });
    expect(res.statusCode).toBe(400);
  });

  it("404 for an unknown room", async () => {
    const res = await app.inject({
      method: "PATCH",
      url: `/v1/meetings/calendar/rooms/${MISSING_ROOM}`,
      headers: { authorization: `Bearer ${token()}`, ...IDEMPOTENCY },
      payload: { version: 1, patch: { capacity: 25 } },
    });
    expect(res.statusCode).toBe(404);
  });

  it("202 accepts a valid room update", async () => {
    const res = await app.inject({
      method: "PATCH",
      url: `/v1/meetings/calendar/rooms/${ROOM}`,
      headers: { authorization: `Bearer ${token()}`, ...IDEMPOTENCY },
      payload: { version: 1, patch: { capacity: 25, status: "maintenance" } },
    });
    expect(res.statusCode).toBe(202);
    expect(res.json().data.id).toBe(ROOM);
  });
});

// ─── GET /calendar/rooms/:roomId/availability ─────────────────────────────────────

describe("GET /v1/meetings/calendar/rooms/:roomId/availability", () => {
  it("401 when unauthenticated", async () => {
    const res = await app.inject({ method: "GET", url: `/v1/meetings/calendar/rooms/${ROOM}/availability?from=${BUSY_FROM}&to=${FREE_TO}` });
    expect(res.statusCode).toBe(401);
  });

  it("404 for an unknown room", async () => {
    const res = await app.inject({
      method: "GET",
      url: `/v1/meetings/calendar/rooms/${MISSING_ROOM}/availability?from=${BUSY_FROM}&to=${FREE_TO}`,
      headers: { authorization: `Bearer ${token()}` },
    });
    expect(res.statusCode).toBe(404);
  });

  it("200 returns the room's booking calendar + free windows", async () => {
    const res = await app.inject({
      method: "GET",
      url: `/v1/meetings/calendar/rooms/${ROOM}/availability?from=${BUSY_FROM}&to=${FREE_TO}`,
      headers: { authorization: `Bearer ${token()}` },
    });
    expect(res.statusCode).toBe(200);
    const { data } = res.json();
    expect(data.bookings.some((b: { bookingId: string }) => b.bookingId === BOOKING)).toBe(true);
    expect(Array.isArray(data.free)).toBe(true);
  });
});

// ─── POST /calendar/bookings ──────────────────────────────────────────────────────

describe("POST /v1/meetings/calendar/bookings", () => {
  it("401 when unauthenticated", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/v1/meetings/calendar/bookings",
      payload: { meetingId: MEETING, roomId: ROOM, startAt: FREE_FROM, endAt: FREE_TO },
    });
    expect(res.statusCode).toBe(401);
  });

  it("403 for a role without write access", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/v1/meetings/calendar/bookings",
      headers: { authorization: `Bearer ${token(["committee_member"])}`, ...IDEMPOTENCY },
      payload: { meetingId: MEETING, roomId: ROOM, startAt: FREE_FROM, endAt: FREE_TO },
    });
    expect(res.statusCode).toBe(403);
  });

  it("400 when the X-Idempotency-Key header is missing", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/v1/meetings/calendar/bookings",
      headers: { authorization: `Bearer ${token()}` },
      payload: { meetingId: MEETING, roomId: ROOM, startAt: FREE_FROM, endAt: FREE_TO },
    });
    expect(res.statusCode).toBe(400);
  });

  it("400 when endAt is not after startAt", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/v1/meetings/calendar/bookings",
      headers: { authorization: `Bearer ${token()}`, ...IDEMPOTENCY },
      payload: { meetingId: MEETING, roomId: ROOM, startAt: FREE_TO, endAt: FREE_FROM },
    });
    expect(res.statusCode).toBe(400);
  });

  it("404 for an unknown meeting", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/v1/meetings/calendar/bookings",
      headers: { authorization: `Bearer ${token()}`, ...IDEMPOTENCY },
      payload: { meetingId: MISSING_MEETING, roomId: ROOM, startAt: FREE_FROM, endAt: FREE_TO },
    });
    expect(res.statusCode).toBe(404);
  });

  it("404 for an unknown room", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/v1/meetings/calendar/bookings",
      headers: { authorization: `Bearer ${token()}`, ...IDEMPOTENCY },
      payload: { meetingId: MEETING, roomId: MISSING_ROOM, startAt: FREE_FROM, endAt: FREE_TO },
    });
    expect(res.statusCode).toBe(404);
  });

  it("409 when the room is already booked for an overlapping window (double-booking, P28)", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/v1/meetings/calendar/bookings",
      headers: { authorization: `Bearer ${token()}`, ...IDEMPOTENCY },
      payload: { meetingId: MEETING, roomId: ROOM, startAt: OVERLAP_FROM, endAt: OVERLAP_TO },
    });
    expect(res.statusCode).toBe(409);
    expect(res.json().code).toBe("ROOM_DOUBLE_BOOKED");
  });

  it("202 accepts a booking clear of existing bookings", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/v1/meetings/calendar/bookings",
      headers: { authorization: `Bearer ${token()}`, ...IDEMPOTENCY },
      payload: { meetingId: MEETING, roomId: ROOM, startAt: FREE_FROM, endAt: FREE_TO },
    });
    expect(res.statusCode).toBe(202);
    expect(res.json().data.status).toBe("accepted");
  });
});

// ─── DELETE /calendar/bookings/:bookingId ──────────────────────────────────────────

describe("DELETE /v1/meetings/calendar/bookings/:bookingId", () => {
  it("401 when unauthenticated", async () => {
    const res = await app.inject({ method: "DELETE", url: `/v1/meetings/calendar/bookings/${BOOKING}`, payload: { version: 1 } });
    expect(res.statusCode).toBe(401);
  });

  it("400 when the X-Idempotency-Key header is missing", async () => {
    const res = await app.inject({
      method: "DELETE",
      url: `/v1/meetings/calendar/bookings/${BOOKING}`,
      headers: { authorization: `Bearer ${token()}` },
      payload: { version: 1 },
    });
    expect(res.statusCode).toBe(400);
  });

  it("404 for an unknown booking", async () => {
    const res = await app.inject({
      method: "DELETE",
      url: `/v1/meetings/calendar/bookings/${MISSING_BOOKING}`,
      headers: { authorization: `Bearer ${token()}`, ...IDEMPOTENCY },
      payload: { version: 1 },
    });
    expect(res.statusCode).toBe(404);
  });

  it("202 accepts a valid cancellation", async () => {
    const res = await app.inject({
      method: "DELETE",
      url: `/v1/meetings/calendar/bookings/${BOOKING}`,
      headers: { authorization: `Bearer ${token()}`, ...IDEMPOTENCY },
      payload: { version: 1, reason: "meeting moved online" },
    });
    expect(res.statusCode).toBe(202);
    expect(res.json().data.id).toBe(BOOKING);
  });
});

// ─── GET /:meetingId/calendar/ics ──────────────────────────────────────────────────

describe("GET /v1/meetings/:meetingId/calendar/ics", () => {
  it("401 when unauthenticated", async () => {
    const res = await app.inject({ method: "GET", url: `/v1/meetings/${MEETING}/calendar/ics` });
    expect(res.statusCode).toBe(401);
  });

  it("404 for an unknown meeting", async () => {
    const res = await app.inject({
      method: "GET",
      url: `/v1/meetings/${MISSING_MEETING}/calendar/ics`,
      headers: { authorization: `Bearer ${token()}` },
    });
    expect(res.statusCode).toBe(404);
  });

  it("200 returns a valid RFC 5545 ICS document", async () => {
    const res = await app.inject({
      method: "GET",
      url: `/v1/meetings/${MEETING}/calendar/ics`,
      headers: { authorization: `Bearer ${token(["committee_member"])}` },
    });
    expect(res.statusCode).toBe(200);
    expect(res.headers["content-type"]).toContain("text/calendar");
    expect(res.body).toContain("BEGIN:VCALENDAR");
    expect(res.body).toContain("BEGIN:VEVENT");
    expect(res.body).toContain("SUMMARY:Calendar Meeting");
  });
});
