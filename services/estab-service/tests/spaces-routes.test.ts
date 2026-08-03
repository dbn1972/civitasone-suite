/**
 * Spaces routes — integration tests (SVC-058 office-space gap).
 * Proves: inventory CQRS accept, availability/occupancy after drain,
 * seat allotment maker-checker (consumer-enforced), no-double-book,
 * release frees the seat, RLS cross-tenant isolation, auth.
 *
 * Writes are queue-first (202 Accepted). Domain side-effects apply in the
 * spaces consumer — tests register consumers on the shared infra queue and
 * drain before asserting projected state.
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { buildApp } from "../src/app.js";
import { signToken } from "@civitasone/auth";
import { MemoryQueue } from "@civitasone/queue";
import { sqlClient } from "../src/shared/db.js";
import { queue } from "../src/shared/infra.js";
import { registerSpacesConsumers } from "../src/modules/spaces/consumer.js";
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

async function drainQueue(): Promise<void> {
  const q = queue as MemoryQueue;
  if (typeof q.drain === "function") await q.drain();
  else await new Promise<void>((r) => setTimeout(r, 400));
}

/** Accept a command (202) and wait for the consumer to settle. */
async function acceptAndDrain(
  method: "POST" | "PATCH",
  url: string,
  headers: Record<string, string>,
  payload: unknown,
): Promise<{ statusCode: number; id: string; body: Record<string, unknown> }> {
  const res = await app.inject({ method, url, headers, payload });
  expect(res.statusCode).toBe(202);
  const body = res.json() as { id: string; status: string; correlationId: string };
  expect(body.status).toBe("accepted");
  expect(body.id).toBeDefined();
  await drainQueue();
  return { statusCode: res.statusCode, id: body.id, body };
}

async function waitFor(
  fn: () => Promise<boolean>,
  ms = 3000,
): Promise<void> {
  const start = Date.now();
  while (Date.now() - start < ms) {
    if (await fn()) return;
    await drainQueue();
    await new Promise<void>((r) => setTimeout(r, 50));
  }
  throw new Error("waitFor timeout");
}

let app: FastifyInstance;
beforeAll(async () => {
  app = await buildApp();
  await app.ready();
  registerSpacesConsumers(queue);
  await queue.start();
});
afterAll(async () => { await app.close(); await sqlClient.end(); });

async function post(url: string, headers: Record<string, string>, payload: unknown) {
  return app.inject({ method: "POST", url, headers, payload });
}
async function patch(url: string, headers: Record<string, string>, payload: unknown) {
  return app.inject({ method: "PATCH", url, headers, payload });
}

describe("Spaces — inventory CRUD + auth", () => {
  it("POST building -> 202", async () => {
    const res = await post("/v1/estab/spaces/buildings", hdr(ACTOR_A),
      { code: `BLD-${Date.now()}`, name: "Secretariat Block A", orgUnit: "GAD" });
    expect(res.statusCode).toBe(202);
    expect(res.json().id).toBeDefined();
    expect(res.json().status).toBe("accepted");
    await drainQueue();
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
    const b = await acceptAndDrain("POST", "/v1/estab/spaces/buildings", hdr(ACTOR_A),
      { code: `BLD-LC-${Date.now()}`, name: "Lifecycle Block" });
    const buildingId = b.id;
    const f = await acceptAndDrain("POST", "/v1/estab/spaces/floors", hdr(ACTOR_A),
      { buildingId, floorNo: 2, name: "2nd Floor" });
    const floorId = f.id;
    const r = await acceptAndDrain("POST", "/v1/estab/spaces/rooms", hdr(ACTOR_A),
      { floorId, roomNo: "204", roomType: "office", capacity: 4 });
    roomId = r.id;
    const s = await acceptAndDrain("POST", "/v1/estab/spaces/seats", hdr(ACTOR_A),
      { roomId, seatNo: "204-1" });
    seatId = s.id;
  });

  it("availability shows the new seat as available", async () => {
    await waitFor(async () => {
      const res = await app.inject({
        method: "GET", url: `/v1/estab/spaces/availability?roomId=${roomId}`, headers: hdr(ACTOR_A),
      });
      if (res.statusCode !== 200) return false;
      const data = res.json().data;
      return data.occupancy.total >= 1
        && data.available.some((x: { id: string }) => x.id === seatId);
    });
  });

  it("request -> allot (maker-checker OK: approver != requester) -> seat allotted", async () => {
    const req = await acceptAndDrain("POST", "/v1/estab/spaces/allotments", hdr(ACTOR_A),
      { targetType: "seat", targetId: seatId, employeeRef: EMPLOYEE, purpose: "New joiner" });
    const allotmentId = req.id;
    // approver ACTOR_B differs from requester ACTOR_A — route accepts 202; consumer applies
    await acceptAndDrain("PATCH", `/v1/estab/spaces/allotments/${allotmentId}/allot`, hdr(ACTOR_B),
      { version: 1 });
    await waitFor(async () => {
      const av = await app.inject({
        method: "GET", url: `/v1/estab/spaces/availability?roomId=${roomId}`, headers: hdr(ACTOR_A),
      });
      const data = av.json().data;
      return !data.available.some((x: { id: string }) => x.id === seatId)
        && data.occupancy.allotted >= 1;
    });
  });

  it("no double-book: a second allot of the same seat is rejected by the consumer", async () => {
    const req2 = await acceptAndDrain("POST", "/v1/estab/spaces/allotments", hdr(ACTOR_A),
      { targetType: "seat", targetId: seatId, employeeRef: EMPLOYEE });
    // Route always 202 under CQRS; consumer rejects SEAT_ALREADY_ALLOTTED → DLQ / no state change
    const al2 = await patch(`/v1/estab/spaces/allotments/${req2.id}/allot`, hdr(ACTOR_B), { version: 1 });
    expect(al2.statusCode).toBe(202);
    await drainQueue();
    // seat remains allotted once (still unavailable)
    const av = await app.inject({
      method: "GET", url: `/v1/estab/spaces/availability?roomId=${roomId}`, headers: hdr(ACTOR_A),
    });
    expect(av.json().data.available.some((x: { id: string }) => x.id === seatId)).toBe(false);
  });

  it("release frees the seat, then it can be re-allotted", async () => {
    const list = await app.inject({
      method: "GET", url: `/v1/estab/spaces/allotments?status=allotted&targetType=seat`, headers: hdr(ACTOR_A),
    });
    const active = list.json().data.find((a: { targetId: string }) => a.targetId === seatId);
    expect(active).toBeDefined();
    await acceptAndDrain("PATCH", `/v1/estab/spaces/allotments/${active.id}/release`, hdr(ACTOR_B),
      { version: active.version, reason: "employee transferred" });
    await waitFor(async () => {
      const av = await app.inject({
        method: "GET", url: `/v1/estab/spaces/availability?roomId=${roomId}`, headers: hdr(ACTOR_A),
      });
      return av.json().data.available.some((x: { id: string }) => x.id === seatId);
    });
    // re-allot succeeds
    const req3 = await acceptAndDrain("POST", "/v1/estab/spaces/allotments", hdr(ACTOR_A),
      { targetType: "seat", targetId: seatId, employeeRef: EMPLOYEE });
    await acceptAndDrain("PATCH", `/v1/estab/spaces/allotments/${req3.id}/allot`, hdr(ACTOR_B),
      { version: 1 });
    await waitFor(async () => {
      const av = await app.inject({
        method: "GET", url: `/v1/estab/spaces/availability?roomId=${roomId}`, headers: hdr(ACTOR_A),
      });
      return !av.json().data.available.some((x: { id: string }) => x.id === seatId);
    });
  });
});

describe("Spaces — maker-checker rejection", () => {
  it("allot by the same actor who requested → route 202; consumer rejects (seat stays free)", async () => {
    const b = await acceptAndDrain("POST", "/v1/estab/spaces/buildings", hdr(ACTOR_A),
      { code: `BLD-MC-${Date.now()}`, name: "MC Block" });
    const f = await acceptAndDrain("POST", "/v1/estab/spaces/floors", hdr(ACTOR_A),
      { buildingId: b.id, floorNo: 1 });
    const r = await acceptAndDrain("POST", "/v1/estab/spaces/rooms", hdr(ACTOR_A),
      { floorId: f.id, roomNo: "R1" });
    const s = await acceptAndDrain("POST", "/v1/estab/spaces/seats", hdr(ACTOR_A),
      { roomId: r.id, seatNo: "R1-1" });
    const req = await acceptAndDrain("POST", "/v1/estab/spaces/allotments", hdr(ACTOR_A),
      { targetType: "seat", targetId: s.id, employeeRef: EMPLOYEE });
    // same actor ACTOR_A tries to approve — CQRS route accepts; consumer enforces maker-checker
    const al = await patch(`/v1/estab/spaces/allotments/${req.id}/allot`, hdr(ACTOR_A), { version: 1 });
    expect(al.statusCode).toBe(202);
    await drainQueue();
    const av = await app.inject({
      method: "GET", url: `/v1/estab/spaces/availability?roomId=${r.id}`, headers: hdr(ACTOR_A),
    });
    expect(av.json().data.available.some((x: { id: string }) => x.id === s.id)).toBe(true);
    const list = await app.inject({
      method: "GET", url: `/v1/estab/spaces/allotments?status=allotted&targetType=seat`, headers: hdr(ACTOR_A),
    });
    expect(list.json().data.some((a: { id: string }) => a.id === req.id)).toBe(false);
  });
});

describe("Spaces — maintenance requests", () => {
  it("POST maintenance -> 202 and appears in list after drain", async () => {
    const b = await acceptAndDrain("POST", "/v1/estab/spaces/buildings", hdr(ACTOR_A),
      { code: `BLD-MT-${Date.now()}`, name: "Maint Block" });
    const res = await acceptAndDrain("POST", "/v1/estab/spaces/maintenance", hdr(ACTOR_A),
      { assetType: "building", assetId: b.id, category: "electrical", priority: "high", description: "AC not working" });
    const id = res.id;
    await acceptAndDrain("PATCH", `/v1/estab/spaces/maintenance/${id}/status`, hdr(ACTOR_A),
      { version: 1, status: "assigned", assignedTo: ACTOR_B });
    await waitFor(async () => {
      const list = await app.inject({
        method: "GET", url: "/v1/estab/spaces/maintenance?status=assigned", headers: hdr(ACTOR_A),
      });
      return list.statusCode === 200
        && list.json().data.some((m: { id: string }) => m.id === id);
    });
  });
});

describe("Spaces — room allotment capacity enforcement", () => {
  const EMP2 = "33333333-cccc-4000-8000-0000000000a2";
  const EMP3 = "33333333-cccc-4000-8000-0000000000a3";

  it("allots up to room capacity (boundary OK), rejects overflow in consumer", async () => {
    const b = await acceptAndDrain("POST", "/v1/estab/spaces/buildings", hdr(ACTOR_A),
      { code: `BLD-RC-${Date.now()}`, name: "RoomCap Block" });
    const f = await acceptAndDrain("POST", "/v1/estab/spaces/floors", hdr(ACTOR_A),
      { buildingId: b.id, floorNo: 3 });
    const r = await acceptAndDrain("POST", "/v1/estab/spaces/rooms", hdr(ACTOR_A),
      { floorId: f.id, roomNo: `RC-${Date.now()}`, roomType: "office", capacity: 2 });
    const roomId = r.id;

    async function allotRoom(employeeRef: string) {
      const req = await acceptAndDrain("POST", "/v1/estab/spaces/allotments", hdr(ACTOR_A),
        { targetType: "room", targetId: roomId, employeeRef });
      return acceptAndDrain("PATCH", `/v1/estab/spaces/allotments/${req.id}/allot`, hdr(ACTOR_B),
        { version: 1 });
    }

    await allotRoom(EMPLOYEE);
    await allotRoom(EMP2); // brings room exactly to capacity (2/2)

    // Over capacity: route 202, consumer rejects — count stays at 2
    const overflowReq = await acceptAndDrain("POST", "/v1/estab/spaces/allotments", hdr(ACTOR_A),
      { targetType: "room", targetId: roomId, employeeRef: EMP3 });
    const a3 = await patch(`/v1/estab/spaces/allotments/${overflowReq.id}/allot`, hdr(ACTOR_B),
      { version: 1 });
    expect(a3.statusCode).toBe(202);
    await drainQueue();

    const list = await app.inject({
      method: "GET",
      url: `/v1/estab/spaces/allotments?status=allotted&targetType=room`,
      headers: hdr(ACTOR_A),
    });
    const activeForRoom = list.json().data.filter((a: { targetId: string }) => a.targetId === roomId);
    expect(activeForRoom).toHaveLength(2);
    expect(list.json().data.some((a: { id: string }) => a.id === overflowReq.id)).toBe(false);
  });
});

describe("Spaces — optimistic-lock lost-update guard", () => {
  async function seatFixture() {
    const b = await acceptAndDrain("POST", "/v1/estab/spaces/buildings", hdr(ACTOR_A),
      { code: `BLD-VC-${Date.now()}`, name: "VerConf Block" });
    const f = await acceptAndDrain("POST", "/v1/estab/spaces/floors", hdr(ACTOR_A),
      { buildingId: b.id, floorNo: 4 });
    const r = await acceptAndDrain("POST", "/v1/estab/spaces/rooms", hdr(ACTOR_A),
      { floorId: f.id, roomNo: `VC-${Date.now()}`, capacity: 4 });
    const roomId = r.id;
    const s = await acceptAndDrain("POST", "/v1/estab/spaces/seats", hdr(ACTOR_A),
      { roomId, seatNo: `VC-${Date.now()}-1` });
    return { roomId, seatId: s.id };
  }

  it("concurrent release of the same allotment: one wins, seat freed once", async () => {
    const { roomId, seatId } = await seatFixture();
    const req = await acceptAndDrain("POST", "/v1/estab/spaces/allotments", hdr(ACTOR_A),
      { targetType: "seat", targetId: seatId, employeeRef: EMPLOYEE });
    await acceptAndDrain("PATCH", `/v1/estab/spaces/allotments/${req.id}/allot`, hdr(ACTOR_B),
      { version: 1 });
    const allotmentId = req.id;
    // both callers hold the same version — routes both 202; consumer applies once
    const [r1, r2] = await Promise.all([
      patch(`/v1/estab/spaces/allotments/${allotmentId}/release`, hdr(ACTOR_B), { version: 2, reason: "first" }),
      patch(`/v1/estab/spaces/allotments/${allotmentId}/release`, hdr(ACTOR_B), { version: 2, reason: "second" }),
    ]);
    expect(r1.statusCode).toBe(202);
    expect(r2.statusCode).toBe(202);
    await drainQueue();
    await waitFor(async () => {
      const av = await app.inject({
        method: "GET", url: `/v1/estab/spaces/availability?roomId=${roomId}`, headers: hdr(ACTOR_A),
      });
      return av.json().data.available.some((x: { id: string }) => x.id === seatId);
    });
  });

  it("concurrent double-allot of the same seat: one wins, seat allotted once", async () => {
    const { seatId, roomId } = await seatFixture();
    const req1 = await acceptAndDrain("POST", "/v1/estab/spaces/allotments", hdr(ACTOR_A),
      { targetType: "seat", targetId: seatId, employeeRef: EMPLOYEE });
    const req2 = await acceptAndDrain("POST", "/v1/estab/spaces/allotments", hdr(ACTOR_A),
      { targetType: "seat", targetId: seatId, employeeRef: EMPLOYEE });
    const [a1, a2] = await Promise.all([
      patch(`/v1/estab/spaces/allotments/${req1.id}/allot`, hdr(ACTOR_B), { version: 1 }),
      patch(`/v1/estab/spaces/allotments/${req2.id}/allot`, hdr(ACTOR_B), { version: 1 }),
    ]);
    expect(a1.statusCode).toBe(202);
    expect(a2.statusCode).toBe(202);
    await drainQueue();
    await waitFor(async () => {
      const av = await app.inject({
        method: "GET", url: `/v1/estab/spaces/availability?roomId=${roomId}`, headers: hdr(ACTOR_A),
      });
      return !av.json().data.available.some((x: { id: string }) => x.id === seatId);
    });
    const list = await app.inject({
      method: "GET", url: `/v1/estab/spaces/allotments?status=allotted&targetType=seat`, headers: hdr(ACTOR_A),
    });
    const winners = list.json().data.filter((a: { targetId: string }) => a.targetId === seatId);
    expect(winners).toHaveLength(1);
  });
});

describe("Spaces — cross-tenant RLS isolation", () => {
  let buildingId: string;
  it("Tenant A creates a building", async () => {
    const res = await acceptAndDrain("POST", "/v1/estab/spaces/buildings", hdr(ACTOR_A, TENANT_A),
      { code: `BLD-RLS-${Date.now()}`, name: "RLS Isolation Block" });
    buildingId = res.id;
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
