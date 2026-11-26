/**
 * estab-service — guest-house lifecycle backend (GAP-ESTAB-GUESTHOUSE-01 / -NEW-01).
 *
 *   pending --approve--> confirmed --checkin--> checked_in --checkout--> checked_out
 *   pending --reject---> rejected
 * Approve/reject are maker-checker (the requesting officer is refused 403); check-in needs an approved
 * booking; add-room is idempotent per (guesthouse, room_no); room detail + guesthouse directory reads.
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { randomUUID, createHmac } from "node:crypto";
import { eq } from "drizzle-orm";
import type { FastifyInstance } from "fastify";
import { MemoryQueue, type Queue, type Handler } from "@civitasone/queue";
import { runWithTenant, withTenantConsumer } from "@civitasone/db";
import { buildApp } from "../src/app.js";
import { db, sqlClient } from "../src/shared/db.js";
import { estabGuesthouses, estabRooms, estabRoomBookings } from "../src/modules/facilities/schema.js";
import { registerFacilitiesConsumers } from "../src/modules/facilities/consumer.js";
import { assertRoomBookingTransition, checkNoRoomOverlap, DomainError } from "../src/modules/facilities/domain.js";
import { COMMANDS } from "../src/topics.js";
import { drainAllQueues } from "../../../vitest.drain";

const JWT_SECRET = process.env.JWT_SECRET ?? "test_secret_for_civitasone_32chr";
function mint(sub: string, roles: string[], tid: string): string {
  const n = Math.floor(Date.now() / 1000);
  const b = (o: object) => Buffer.from(JSON.stringify(o)).toString("base64url");
  const h = b({ alg: "HS256", typ: "JWT" });
  const p = b({ sub, iss: "civitasone-dev", tid, tenantId: tid, sid: "t", email: "t@t.dev", name: "Test", roles, iat: n, exp: n + 3600 });
  return `${h}.${p}.${createHmac("sha256", JWT_SECRET).update(`${h}.${p}`).digest("base64url")}`;
}
const hdr = (actor: string, roles: string[], tid: string) => ({ authorization: `Bearer ${mint(actor, roles, tid)}`, "x-tenant-id": tid });
function wireTenantAwareQueue(q: Queue): Queue {
  const raw = q.subscribe.bind(q);
  q.subscribe = ((topic: string, handler: Handler) => raw(topic, withTenantConsumer(handler) as Handler)) as typeof q.subscribe;
  return q;
}

const T = randomUUID();
const OFFICER = randomUUID();   // Sunita Verma, raises the booking (maker)
const CHECKER = randomUUID();   // Rakesh Menon, approves (checker)
const GH = randomUUID();
const ROOM = randomUUID();
const ROLES = ["estab_officer"];

let app: FastifyInstance;
let q: Queue;

beforeAll(async () => {
  app = await buildApp();
  q = wireTenantAwareQueue(new MemoryQueue());
  registerFacilitiesConsumers(q);
  await q.start();
  await runWithTenant(T, () => db.transaction(async (tx) => {
    await tx.insert(estabGuesthouses).values({ id: GH, tenantId: T, name: "Krishna Menon Marg Guest House", location: "New Delhi", createdBy: OFFICER, updatedBy: OFFICER });
    await tx.insert(estabRooms).values({ id: ROOM, tenantId: T, guesthouseId: GH, roomNo: "204", type: "standard", capacity: 2, createdBy: OFFICER, updatedBy: OFFICER });
  }));
});
afterAll(async () => {
  await q.stop();
  await runWithTenant(T, () => db.transaction(async (tx) => {
    await tx.delete(estabRoomBookings).where(eq(estabRoomBookings.tenantId, T));
    await tx.delete(estabRooms).where(eq(estabRooms.tenantId, T));
    await tx.delete(estabGuesthouses).where(eq(estabGuesthouses.tenantId, T));
  }));
  await app.close();
  await sqlClient.end();
});

async function seedBooking(status: string, createdBy = OFFICER, day = 10): Promise<string> {
  const id = randomUUID();
  await runWithTenant(T, () => db.transaction((tx) => tx.insert(estabRoomBookings).values({
    id, tenantId: T, roomId: ROOM, guestName: "Dr. Anjali Deshpande", sponsorDept: "Health",
    checkIn: new Date(`2026-12-${String(day).padStart(2, "0")}T08:30:00Z`),
    checkOut: new Date(`2026-12-${String(day + 1).padStart(2, "0")}T06:30:00Z`),
    status, createdBy, updatedBy: createdBy,
  })));
  return id;
}
const statusOf = async (id: string) =>
  (await runWithTenant(T, () => db.transaction((tx) => tx.select().from(estabRoomBookings).where(eq(estabRoomBookings.id, id)))))[0];
const publish = async (type: string, actorId: string, payload: Record<string, unknown>) => {
  await q.publish(type, { messageId: randomUUID(), type, tenantId: T, actorId, correlationId: "c", schemaVersion: "1.0", payload: { tenantId: T, ...payload } });
  await drainAllQueues();
};

describe("domain transitions", () => {
  it("allows only the documented transitions", () => {
    expect(() => assertRoomBookingTransition("pending", "approve")).not.toThrow();
    expect(() => assertRoomBookingTransition("pending", "reject")).not.toThrow();
    expect(() => assertRoomBookingTransition("confirmed", "checkin")).not.toThrow();
    expect(() => assertRoomBookingTransition("booked", "checkin")).not.toThrow();
    expect(() => assertRoomBookingTransition("checked_in", "checkout")).not.toThrow();
    for (const [s, a] of [["pending", "checkin"], ["confirmed", "approve"], ["rejected", "approve"], ["confirmed", "checkout"], ["checked_out", "checkin"]] as const) {
      expect(() => assertRoomBookingTransition(s, a)).toThrow(DomainError);
    }
  });
  it("a pending request holds the room", () => {
    const w = [{ checkIn: "2026-12-10T08:30:00Z", checkOut: "2026-12-11T06:30:00Z", status: "pending" }];
    expect(() => checkNoRoomOverlap(w, new Date("2026-12-10T10:00:00Z"), new Date("2026-12-10T20:00:00Z"))).toThrow(DomainError);
    const rejected = [{ ...w[0]!, status: "rejected" }];
    expect(() => checkNoRoomOverlap(rejected, new Date("2026-12-10T10:00:00Z"), new Date("2026-12-10T20:00:00Z"))).not.toThrow();
  });
});

describe("approve / reject (maker-checker)", () => {
  it("the requesting officer cannot approve their own booking: 403 and nothing changes", async () => {
    const id = await seedBooking("pending", OFFICER, 10);
    const res = await app.inject({ method: "POST", url: `/v1/estab/room-bookings/${id}/approve`, headers: hdr(OFFICER, ROLES, T) });
    expect(res.statusCode).toBe(403);
    expect(res.json().code).toBe("MAKER_CHECKER_VIOLATION");
    expect((await statusOf(id))!.status).toBe("pending");
  });

  it("another officer approves over HTTP (202) and the consumer confirms it with the decision recorded", async () => {
    const id = await seedBooking("pending", OFFICER, 12);
    const res = await app.inject({ method: "POST", url: `/v1/estab/room-bookings/${id}/approve`, headers: hdr(CHECKER, ROLES, T) });
    expect(res.statusCode).toBe(202);
    await publish(COMMANDS.roomApprove, CHECKER, { bookingId: id });
    const row = (await statusOf(id))!;
    expect(row.status).toBe("confirmed");
    expect(row.decidedBy).toBe(CHECKER);
    expect(row.decidedAt).toBeTruthy();
  });

  it("the consumer refuses a maker's own approval even if the route was bypassed", async () => {
    const id = await seedBooking("pending", OFFICER, 14);
    await publish(COMMANDS.roomApprove, OFFICER, { bookingId: id }).catch(() => undefined);
    expect((await statusOf(id))!.status).toBe("pending");
  });

  it("approving a booking that is not pending answers 409", async () => {
    const id = await seedBooking("confirmed", OFFICER, 16);
    const res = await app.inject({ method: "POST", url: `/v1/estab/room-bookings/${id}/approve`, headers: hdr(CHECKER, ROLES, T) });
    expect(res.statusCode).toBe(409);
    expect(res.json().code).toBe("INVALID_STATE");
  });

  it("reject needs a reason (400), then records it and sets rejected", async () => {
    const id = await seedBooking("pending", OFFICER, 18);
    const bad = await app.inject({ method: "POST", url: `/v1/estab/room-bookings/${id}/reject`, headers: hdr(CHECKER, ROLES, T), payload: {} });
    expect(bad.statusCode).toBe(400);
    const ok = await app.inject({ method: "POST", url: `/v1/estab/room-bookings/${id}/reject`, headers: hdr(CHECKER, ROLES, T), payload: { reason: "Room reserved for the Secretary's visit" } });
    expect(ok.statusCode).toBe(202);
    await publish(COMMANDS.roomReject, CHECKER, { bookingId: id, reason: "Room reserved for the Secretary's visit" });
    const row = (await statusOf(id))!;
    expect(row.status).toBe("rejected");
    expect(row.decisionReason).toBe("Room reserved for the Secretary's visit");
  });

  it("a non-estab role is refused (403) and an unknown booking is 404", async () => {
    const id = await seedBooking("pending", OFFICER, 20);
    expect((await app.inject({ method: "POST", url: `/v1/estab/room-bookings/${id}/approve`, headers: hdr(CHECKER, ["citizen"], T) })).statusCode).toBe(403);
    expect((await app.inject({ method: "POST", url: `/v1/estab/room-bookings/${randomUUID()}/approve`, headers: hdr(CHECKER, ROLES, T) })).statusCode).toBe(404);
  });
});

describe("check-in / check-out follow approval", () => {
  it("check-in of a pending booking is 409; of a confirmed one is accepted; check-out needs checked_in", async () => {
    const pending = await seedBooking("pending", OFFICER, 22);
    const r1 = await app.inject({ method: "PATCH", url: `/v1/estab/room-bookings/${pending}/checkin`, headers: hdr(CHECKER, ROLES, T) });
    expect(r1.statusCode).toBe(409);

    const confirmed = await seedBooking("confirmed", OFFICER, 24);
    expect((await app.inject({ method: "PATCH", url: `/v1/estab/room-bookings/${confirmed}/checkout`, headers: hdr(CHECKER, ROLES, T), payload: { chargesMinor: 0 } })).statusCode).toBe(409);
    expect((await app.inject({ method: "PATCH", url: `/v1/estab/room-bookings/${confirmed}/checkin`, headers: hdr(CHECKER, ROLES, T) })).statusCode).toBe(202);
    await publish(COMMANDS.roomCheckin, CHECKER, { bookingId: confirmed });
    expect((await statusOf(confirmed))!.status).toBe("checked_in");

    await publish(COMMANDS.roomCheckout, CHECKER, { bookingId: confirmed, chargesMinor: 450000 });
    const row = (await statusOf(confirmed))!;
    expect(row.status).toBe("checked_out");
    expect(row.chargesMinor).toBe(450000n);
  });
});

describe("rooms directory: add-room, room detail, guesthouses", () => {
  it("adds a room (202), the consumer creates it, a duplicate room number is 409", async () => {
    const body = { guesthouseId: GH, roomNo: "301", type: "suite", capacity: 3 };
    const res = await app.inject({ method: "POST", url: "/v1/estab/rooms", headers: hdr(OFFICER, ROLES, T), payload: body });
    expect(res.statusCode).toBe(202);
    const id = res.json().id as string;
    await publish(COMMANDS.roomAdd, OFFICER, { id, ...body });
    const rows = await runWithTenant(T, () => db.transaction((tx) => tx.select().from(estabRooms).where(eq(estabRooms.id, id))));
    expect(rows[0]).toMatchObject({ roomNo: "301", type: "suite", capacity: 3, status: "available", guesthouseId: GH });

    const dup = await app.inject({ method: "POST", url: "/v1/estab/rooms", headers: hdr(OFFICER, ROLES, T), payload: body });
    expect(dup.statusCode).toBe(409);
    expect(dup.json().code).toBe("ROOM_EXISTS");
    // A replay that slipped past the route is a no-op, not a duplicate row.
    await publish(COMMANDS.roomAdd, OFFICER, { id: randomUUID(), ...body });
    const all = await runWithTenant(T, () => db.transaction((tx) => tx.select().from(estabRooms).where(eq(estabRooms.guesthouseId, GH))));
    expect(all.filter((r) => r.roomNo === "301")).toHaveLength(1);
  });

  it("add-room validates the body and the guesthouse", async () => {
    expect((await app.inject({ method: "POST", url: "/v1/estab/rooms", headers: hdr(OFFICER, ROLES, T), payload: { guesthouseId: GH, roomNo: "" } })).statusCode).toBe(400);
    expect((await app.inject({ method: "POST", url: "/v1/estab/rooms", headers: hdr(OFFICER, ROLES, T), payload: { guesthouseId: GH, roomNo: "997", type: "deluxe" } })).statusCode).toBe(400);
    expect((await app.inject({ method: "POST", url: "/v1/estab/rooms", headers: hdr(OFFICER, ROLES, T), payload: { guesthouseId: randomUUID(), roomNo: "999" } })).statusCode).toBe(404);
    expect((await app.inject({ method: "POST", url: "/v1/estab/rooms", headers: hdr(OFFICER, ["audit_officer"], T), payload: { guesthouseId: GH, roomNo: "998" } })).statusCode).toBe(403);
  });

  it("room detail returns the room, its guesthouse and recent bookings; another tenant gets 404", async () => {
    await seedBooking("confirmed", OFFICER, 26);
    const res = await app.inject({ method: "GET", url: `/v1/estab/rooms/${ROOM}`, headers: hdr(CHECKER, ["audit_officer"], T) });
    expect(res.statusCode).toBe(200);
    const d = res.json().data;
    expect(d).toMatchObject({ id: ROOM, roomNo: "204", type: "standard", capacity: 2, guesthouseName: "Krishna Menon Marg Guest House" });
    expect(d.bookings.length).toBeGreaterThan(0);
    expect(d.bookings[0]).toMatchObject({ guestName: "Dr. Anjali Deshpande", department: "Health" });
    const other = await app.inject({ method: "GET", url: `/v1/estab/rooms/${ROOM}`, headers: hdr(CHECKER, ROLES, randomUUID()) });
    expect(other.statusCode).toBe(404);
  });

  it("lists the tenant's guesthouses for the add-room picker", async () => {
    const res = await app.inject({ method: "GET", url: "/v1/estab/guesthouses", headers: hdr(CHECKER, ROLES, T) });
    expect(res.statusCode).toBe(200);
    expect(res.json().data).toEqual([expect.objectContaining({ id: GH, name: "Krishna Menon Marg Guest House", location: "New Delhi" })]);
  });
});

describe("new bookings start pending", () => {
  it("the book-room consumer inserts status 'pending' (awaiting approval)", async () => {
    const id = randomUUID();
    await publish(COMMANDS.roomBook, OFFICER, { id, roomId: ROOM, guestName: "Prof. Ramesh Iyer", checkIn: "2026-12-28T08:30:00.000Z", checkOut: "2026-12-29T06:30:00.000Z", sponsorDept: "Education" });
    expect((await statusOf(id))!.status).toBe("pending");
  });
});
