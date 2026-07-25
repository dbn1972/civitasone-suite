/**
 * Spaces routes — integration tests (SVC-058 office-space gap).
 * Proves: inventory CRUD, availability/occupancy, seat allotment maker-checker,
 * no-double-book, release frees the seat, RLS cross-tenant isolation, auth.
 *
 * Writes are synchronous + transactional, so post-write reads assert real state.
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { buildApp } from "../src/app.js";
import { signToken } from "@civitasone/auth";
import { sqlClient } from "../src/shared/db.js";
import type { FastifyInstance } from "fastify";

const SECRET = "test_secret_for_civitasone_32chr";
const TENANT_A = "11111111-cccc-4000-8000-000000000001";
const TENANT_B = "11111111-cccc-4000-8000-000000000002";
const ACTOR_A  = "22222222-cccc-4000-8000-00000000000a";
const ACTOR_B  = "22222222-cccc-4000-8000-00000000000b";
const EMPLOYEE = "33333333-cccc-4000-8000-000000000099";

function hdr(sub: string, tid = TENANT_A, roles = ["estab_admin", "super_admin"]) {
  return { authorization: `Bearer ${signToken({ sub, tid, roles, sid: "s1" }, SECRET, 3600)}` };
}

let app: FastifyInstance;
beforeAll(async () => { app = await buildApp(); await app.ready(); });
afterAll(async () => { await app.close(); await sqlClient.end(); });

async function post(url: string, headers: Record<string, string>, payload: unknown) {
  return app.inject({ method: "POST", url, headers, payload });
}
async function patch(url: string, headers: Record<string, string>, payload: unknown) {
  return app.inject({ method: "PATCH", url, headers, payload });
}

describe("Spaces — inventory CRUD + auth", () => {
  it("POST building -> 201", async () => {
    const res = await post("/v1/estab/spaces/buildings", hdr(ACTOR_A),
      { code: `BLD-${Date.now()}`, name: "Secretariat Block A", orgUnit: "GAD" });
    expect(res.statusCode).toBe(201);
    expect(res.json().data.id).toBeDefined();
  });
  it("POST building -> 400 missing name", async () => {
    const res = await post("/v1/estab/spaces/buildings", hdr(ACTOR_A), { code: "X" });
    expect(res.statusCode).toBe(400);
  });
  it("POST building -> 403 wrong role", async () => {
    const res = await post("/v1/estab/spaces/buildings", hdr(ACTOR_A, TENANT_A, ["citizen"]),
      { code: "Y", name: "n" });
    expect(res.statusCode).toBe(403);
  });
  it("POST building -> 401 no token", async () => {
    const res = await app.inject({ method: "POST", url: "/v1/estab/spaces/buildings", payload: { code: "Z", name: "n" } });
    expect(res.statusCode).toBe(401);
  });
  it("GET buildings -> 200 array", async () => {
    const res = await app.inject({ method: "GET", url: "/v1/estab/spaces/buildings", headers: hdr(ACTOR_A) });
    expect(res.statusCode).toBe(200);
    expect(Array.isArray(res.json().data)).toBe(true);
  });
});

describe("Spaces — full allotment lifecycle + availability", () => {
  let seatId: string; let roomId: string;

  it("builds building -> floor -> room -> seat", async () => {
    const b = await post("/v1/estab/spaces/buildings", hdr(ACTOR_A),
      { code: `BLD-LC-${Date.now()}`, name: "Lifecycle Block" });
    const buildingId = b.json().data.id;
    const f = await post("/v1/estab/spaces/floors", hdr(ACTOR_A), { buildingId, floorNo: 2, name: "2nd Floor" });
    expect(f.statusCode).toBe(201);
    const floorId = f.json().data.id;
    const r = await post("/v1/estab/spaces/rooms", hdr(ACTOR_A),
      { floorId, roomNo: "204", roomType: "office", capacity: 4 });
    expect(r.statusCode).toBe(201);
    roomId = r.json().data.id;
    const s = await post("/v1/estab/spaces/seats", hdr(ACTOR_A), { roomId, seatNo: "204-1" });
    expect(s.statusCode).toBe(201);
    seatId = s.json().data.id;
  });

  it("availability shows the new seat as available", async () => {
    const res = await app.inject({
      method: "GET", url: `/v1/estab/spaces/availability?roomId=${roomId}`, headers: hdr(ACTOR_A),
    });
    expect(res.statusCode).toBe(200);
    const data = res.json().data;
    expect(data.occupancy.total).toBeGreaterThanOrEqual(1);
    expect(data.available.some((x: { id: string }) => x.id === seatId)).toBe(true);
  });

  it("request -> allot (maker-checker OK: approver != requester) -> seat allotted", async () => {
    const req = await post("/v1/estab/spaces/allotments", hdr(ACTOR_A),
      { targetType: "seat", targetId: seatId, employeeRef: EMPLOYEE, purpose: "New joiner" });
    expect(req.statusCode).toBe(201);
    const allotmentId = req.json().data.id;
    // approver ACTOR_B differs from requester ACTOR_A
    const al = await patch(`/v1/estab/spaces/allotments/${allotmentId}/allot`, hdr(ACTOR_B), { version: 1 });
    expect(al.statusCode).toBe(200);
    // seat no longer available
    const av = await app.inject({ method: "GET", url: `/v1/estab/spaces/availability?roomId=${roomId}`, headers: hdr(ACTOR_A) });
    expect(av.json().data.available.some((x: { id: string }) => x.id === seatId)).toBe(false);
    expect(av.json().data.occupancy.allotted).toBeGreaterThanOrEqual(1);
  });

  it("no double-book: a second allot of the same seat -> 409", async () => {
    const req2 = await post("/v1/estab/spaces/allotments", hdr(ACTOR_A),
      { targetType: "seat", targetId: seatId, employeeRef: EMPLOYEE });
    const allotmentId2 = req2.json().data.id;
    const al2 = await patch(`/v1/estab/spaces/allotments/${allotmentId2}/allot`, hdr(ACTOR_B), { version: 1 });
    expect(al2.statusCode).toBe(409);
    expect(al2.json().code).toBe("SEAT_ALREADY_ALLOTTED");
  });

  it("release frees the seat, then it can be re-allotted", async () => {
    // find the active allotment for the seat
    const list = await app.inject({
      method: "GET", url: `/v1/estab/spaces/allotments?status=allotted&targetType=seat`, headers: hdr(ACTOR_A),
    });
    const active = list.json().data.find((a: { targetId: string }) => a.targetId === seatId);
    expect(active).toBeDefined();
    const rel = await patch(`/v1/estab/spaces/allotments/${active.id}/release`, hdr(ACTOR_B),
      { version: active.version, reason: "employee transferred" });
    expect(rel.statusCode).toBe(200);
    // seat available again
    const av = await app.inject({ method: "GET", url: `/v1/estab/spaces/availability?roomId=${roomId}`, headers: hdr(ACTOR_A) });
    expect(av.json().data.available.some((x: { id: string }) => x.id === seatId)).toBe(true);
    // re-allot succeeds
    const req3 = await post("/v1/estab/spaces/allotments", hdr(ACTOR_A),
      { targetType: "seat", targetId: seatId, employeeRef: EMPLOYEE });
    const al3 = await patch(`/v1/estab/spaces/allotments/${req3.json().data.id}/allot`, hdr(ACTOR_B), { version: 1 });
    expect(al3.statusCode).toBe(200);
  });
});

describe("Spaces — maker-checker rejection", () => {
  it("allot by the same actor who requested -> 403 MAKER_CHECKER_VIOLATION", async () => {
    const b = await post("/v1/estab/spaces/buildings", hdr(ACTOR_A), { code: `BLD-MC-${Date.now()}`, name: "MC Block" });
    const f = await post("/v1/estab/spaces/floors", hdr(ACTOR_A), { buildingId: b.json().data.id, floorNo: 1 });
    const r = await post("/v1/estab/spaces/rooms", hdr(ACTOR_A), { floorId: f.json().data.id, roomNo: "R1" });
    const s = await post("/v1/estab/spaces/seats", hdr(ACTOR_A), { roomId: r.json().data.id, seatNo: "R1-1" });
    const req = await post("/v1/estab/spaces/allotments", hdr(ACTOR_A),
      { targetType: "seat", targetId: s.json().data.id, employeeRef: EMPLOYEE });
    // same actor ACTOR_A tries to approve their own request
    const al = await patch(`/v1/estab/spaces/allotments/${req.json().data.id}/allot`, hdr(ACTOR_A), { version: 1 });
    expect(al.statusCode).toBe(403);
    expect(al.json().code).toBe("MAKER_CHECKER_VIOLATION");
  });
});

describe("Spaces — maintenance requests", () => {
  it("POST maintenance -> 201 and appears in list", async () => {
    const b = await post("/v1/estab/spaces/buildings", hdr(ACTOR_A), { code: `BLD-MT-${Date.now()}`, name: "Maint Block" });
    const res = await post("/v1/estab/spaces/maintenance", hdr(ACTOR_A),
      { assetType: "building", assetId: b.json().data.id, category: "electrical", priority: "high", description: "AC not working" });
    expect(res.statusCode).toBe(201);
    const id = res.json().data.id;
    const upd = await patch(`/v1/estab/spaces/maintenance/${id}/status`, hdr(ACTOR_A),
      { version: 1, status: "assigned", assignedTo: ACTOR_B });
    expect(upd.statusCode).toBe(200);
    const list = await app.inject({ method: "GET", url: "/v1/estab/spaces/maintenance?status=assigned", headers: hdr(ACTOR_A) });
    expect(list.statusCode).toBe(200);
    expect(list.json().data.some((m: { id: string }) => m.id === id)).toBe(true);
  });
});

describe("Spaces — room allotment capacity enforcement", () => {
  const EMP2 = "33333333-cccc-4000-8000-0000000000a2";
  const EMP3 = "33333333-cccc-4000-8000-0000000000a3";

  it("allots up to room capacity (boundary OK), rejects overflow -> 409 ROOM_AT_CAPACITY", async () => {
    const b = await post("/v1/estab/spaces/buildings", hdr(ACTOR_A), { code: `BLD-RC-${Date.now()}`, name: "RoomCap Block" });
    const f = await post("/v1/estab/spaces/floors", hdr(ACTOR_A), { buildingId: b.json().data.id, floorNo: 3 });
    const r = await post("/v1/estab/spaces/rooms", hdr(ACTOR_A),
      { floorId: f.json().data.id, roomNo: `RC-${Date.now()}`, roomType: "office", capacity: 2 });
    const roomId = r.json().data.id;

    async function allotRoom(employeeRef: string) {
      const req = await post("/v1/estab/spaces/allotments", hdr(ACTOR_A),
        { targetType: "room", targetId: roomId, employeeRef });
      return patch(`/v1/estab/spaces/allotments/${req.json().data.id}/allot`, hdr(ACTOR_B), { version: 1 });
    }

    const a1 = await allotRoom(EMPLOYEE);
    expect(a1.statusCode).toBe(200);
    const a2 = await allotRoom(EMP2); // brings room exactly to capacity (2/2)
    expect(a2.statusCode).toBe(200);
    const a3 = await allotRoom(EMP3); // over capacity
    expect(a3.statusCode).toBe(409);
    expect(a3.json().code).toBe("ROOM_AT_CAPACITY");
  });
});

describe("Spaces — optimistic-lock lost-update guard", () => {
  async function seatFixture() {
    const b = await post("/v1/estab/spaces/buildings", hdr(ACTOR_A), { code: `BLD-VC-${Date.now()}`, name: "VerConf Block" });
    const f = await post("/v1/estab/spaces/floors", hdr(ACTOR_A), { buildingId: b.json().data.id, floorNo: 4 });
    const r = await post("/v1/estab/spaces/rooms", hdr(ACTOR_A), { floorId: f.json().data.id, roomNo: `VC-${Date.now()}`, capacity: 4 });
    const roomId = r.json().data.id;
    const s = await post("/v1/estab/spaces/seats", hdr(ACTOR_A), { roomId, seatNo: `VC-${Date.now()}-1` });
    return { roomId, seatId: s.json().data.id as string };
  }

  it("concurrent release of the same allotment: one 200, the loser 409 VERSION_CONFLICT, seat freed once", async () => {
    const { roomId, seatId } = await seatFixture();
    const req = await post("/v1/estab/spaces/allotments", hdr(ACTOR_A), { targetType: "seat", targetId: seatId, employeeRef: EMPLOYEE });
    const al = await patch(`/v1/estab/spaces/allotments/${req.json().data.id}/allot`, hdr(ACTOR_B), { version: 1 });
    expect(al.statusCode).toBe(200);
    const allotmentId = req.json().data.id;
    // both callers hold the same (currently-correct) version 2
    const [r1, r2] = await Promise.all([
      patch(`/v1/estab/spaces/allotments/${allotmentId}/release`, hdr(ACTOR_B), { version: 2, reason: "first" }),
      patch(`/v1/estab/spaces/allotments/${allotmentId}/release`, hdr(ACTOR_B), { version: 2, reason: "second" }),
    ]);
    const codes = [r1.statusCode, r2.statusCode].sort();
    expect(codes).toEqual([200, 409]);
    const loser = r1.statusCode === 409 ? r1 : r2;
    expect(loser.json().code).toBe("VERSION_CONFLICT");
    // seat released exactly once and is available again (loser fired no side effect)
    const av = await app.inject({ method: "GET", url: `/v1/estab/spaces/availability?roomId=${roomId}`, headers: hdr(ACTOR_A) });
    expect(av.json().data.available.some((x: { id: string }) => x.id === seatId)).toBe(true);
  });

  it("concurrent double-allot of the same seat: one 200, the loser 409 SEAT_ALREADY_ALLOTTED", async () => {
    const { seatId } = await seatFixture();
    const req1 = await post("/v1/estab/spaces/allotments", hdr(ACTOR_A), { targetType: "seat", targetId: seatId, employeeRef: EMPLOYEE });
    const req2 = await post("/v1/estab/spaces/allotments", hdr(ACTOR_A), { targetType: "seat", targetId: seatId, employeeRef: EMPLOYEE });
    const [a1, a2] = await Promise.all([
      patch(`/v1/estab/spaces/allotments/${req1.json().data.id}/allot`, hdr(ACTOR_B), { version: 1 }),
      patch(`/v1/estab/spaces/allotments/${req2.json().data.id}/allot`, hdr(ACTOR_B), { version: 1 }),
    ]);
    const codes = [a1.statusCode, a2.statusCode].sort();
    expect(codes).toEqual([200, 409]);
    const loser = a1.statusCode === 409 ? a1 : a2;
    expect(loser.json().code).toBe("SEAT_ALREADY_ALLOTTED");
  });
});

describe("Spaces — cross-tenant RLS isolation", () => {
  let buildingId: string;
  it("Tenant A creates a building", async () => {
    const res = await post("/v1/estab/spaces/buildings", hdr(ACTOR_A, TENANT_A),
      { code: `BLD-RLS-${Date.now()}`, name: "RLS Isolation Block" });
    expect(res.statusCode).toBe(201);
    buildingId = res.json().data.id;
  });
  it("Tenant B list does not include Tenant A building", async () => {
    const res = await app.inject({ method: "GET", url: "/v1/estab/spaces/buildings",
      headers: hdr(ACTOR_B, TENANT_B) });
    expect(res.statusCode).toBe(200);
    expect(res.json().data.some((b: { id: string }) => b.id === buildingId)).toBe(false);
  });
  it("Tenant B GET Tenant A building by id -> 404", async () => {
    const res = await app.inject({ method: "GET", url: `/v1/estab/spaces/buildings/${buildingId}`,
      headers: hdr(ACTOR_B, TENANT_B) });
    expect(res.statusCode).toBe(404);
  });
});
