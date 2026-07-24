/**
 * Quarters routes — integration tests (SVC-058).
 * Tests: quarter CRUD, allotment workflow, licence-fee rates, auth.
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { buildApp } from "../src/app.js";
import { signToken } from "@civitasone/auth";
import type { FastifyInstance } from "fastify";

const SECRET = "test_secret_for_civitasone_32chr";
const TENANT = "11111111-bbbb-4000-8000-000000000001";
const ACTOR  = "22222222-bbbb-4000-8000-000000000001";
const OTHER  = "22222222-bbbb-4000-8000-000000000099";
const QTR_ID = "33333333-bbbb-4000-8000-000000000001";

function authHeader(roles = ["estab_admin", "super_admin"]) {
  const token = signToken({ sub: ACTOR, tid: TENANT, roles, sid: "s1" }, SECRET, 3600);
  return { authorization: `Bearer ${token}` };
}

let app: FastifyInstance;

beforeAll(async () => { app = await buildApp(); await app.ready(); });
afterAll(async () => { await app.close(); });

describe("Quarter inventory", () => {
  it("POST /v1/estab/quarters → 202", async () => {
    const res = await app.inject({
      method: "POST", url: "/v1/estab/quarters",
      headers: authHeader(),
      payload: {
        quarterNo: "Q-IV-102", quarterType: "type_iv",
        category: "general", address: "Sector 12, Block B",
        carpetAreaSqft: 850,
      },
    });
    expect(res.statusCode).toBe(202);
  });

  it("POST /v1/estab/quarters → 400 invalid type", async () => {
    const res = await app.inject({
      method: "POST", url: "/v1/estab/quarters",
      headers: authHeader(),
      payload: { quarterNo: "Q-X-1", quarterType: "type_x" },
    });
    expect(res.statusCode).toBe(400);
  });

  it("POST /v1/estab/quarters → 403 wrong role", async () => {
    const res = await app.inject({
      method: "POST", url: "/v1/estab/quarters",
      headers: authHeader(["citizen"]),
      payload: { quarterNo: "Q-IV-103", quarterType: "type_iv" },
    });
    expect(res.statusCode).toBe(403);
  });

  it("POST /v1/estab/quarters → 401 no token", async () => {
    const res = await app.inject({
      method: "POST", url: "/v1/estab/quarters",
      payload: { quarterNo: "Q-IV-104", quarterType: "type_iv" },
    });
    expect(res.statusCode).toBe(401);
  });

  it("GET /v1/estab/quarters → 200", async () => {
    const res = await app.inject({
      method: "GET", url: "/v1/estab/quarters",
      headers: authHeader(),
    });
    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.body);
    expect(body.data).toBeInstanceOf(Array);
  });

  it("GET /v1/estab/quarters/:id → 404 not found", async () => {
    const res = await app.inject({
      method: "GET", url: `/v1/estab/quarters/${QTR_ID}`,
      headers: authHeader(),
    });
    expect(res.statusCode).toBe(404);
  });
});

describe("Quarter allotment workflow", () => {
  it("POST /v1/estab/quarter-allotments → 202 (apply)", async () => {
    const res = await app.inject({
      method: "POST", url: "/v1/estab/quarter-allotments",
      headers: authHeader(["employee"]),
      payload: {
        quarterId: QTR_ID, employeeRef: OTHER,
        designation: "Section Officer", payLevel: "7", seniorityMonths: 36,
      },
    });
    expect(res.statusCode).toBe(202);
  });

  it("PATCH /v1/estab/quarter-allotments/:id/allot → 202", async () => {
    const fakeId = "44444444-bbbb-4000-8000-000000000001";
    const res = await app.inject({
      method: "PATCH", url: `/v1/estab/quarter-allotments/${fakeId}/allot`,
      headers: authHeader(),
      payload: { version: 1 },
    });
    expect(res.statusCode).toBe(202);
  });

  it("PATCH /v1/estab/quarter-allotments/:id/occupy → 202", async () => {
    const fakeId = "44444444-bbbb-4000-8000-000000000001";
    const res = await app.inject({
      method: "PATCH", url: `/v1/estab/quarter-allotments/${fakeId}/occupy`,
      headers: authHeader(),
      payload: { version: 1 },
    });
    expect(res.statusCode).toBe(202);
  });

  it("PATCH /v1/estab/quarter-allotments/:id/vacation-notice → 202", async () => {
    const fakeId = "44444444-bbbb-4000-8000-000000000001";
    const res = await app.inject({
      method: "PATCH", url: `/v1/estab/quarter-allotments/${fakeId}/vacation-notice`,
      headers: authHeader(),
      payload: { version: 1, vacationDueDate: "2026-09-30" },
    });
    expect(res.statusCode).toBe(202);
  });

  it("PATCH /v1/estab/quarter-allotments/:id/vacate → 202", async () => {
    const fakeId = "44444444-bbbb-4000-8000-000000000001";
    const res = await app.inject({
      method: "PATCH", url: `/v1/estab/quarter-allotments/${fakeId}/vacate`,
      headers: authHeader(),
      payload: { version: 1, handoverNotes: "All furniture intact" },
    });
    expect(res.statusCode).toBe(202);
  });

  it("GET /v1/estab/quarter-allotments → 200", async () => {
    const res = await app.inject({
      method: "GET", url: "/v1/estab/quarter-allotments",
      headers: authHeader(),
    });
    expect(res.statusCode).toBe(200);
  });
});

describe("Licence-fee rates", () => {
  it("POST /v1/estab/quarter-licence-fees → 202", async () => {
    const res = await app.inject({
      method: "POST", url: "/v1/estab/quarter-licence-fees",
      headers: authHeader(),
      payload: {
        quarterType: "type_iv", payLevel: "7",
        monthlyMinor: 350000, effectiveFrom: "2026-04-01",
      },
    });
    expect(res.statusCode).toBe(202);
  });

  it("POST /v1/estab/quarter-licence-fees → 400 invalid", async () => {
    const res = await app.inject({
      method: "POST", url: "/v1/estab/quarter-licence-fees",
      headers: authHeader(),
      payload: { quarterType: "type_iv", payLevel: "7", monthlyMinor: -100 },
    });
    expect(res.statusCode).toBe(400);
  });

  it("GET /v1/estab/quarter-licence-fees → 200", async () => {
    const res = await app.inject({
      method: "GET", url: "/v1/estab/quarter-licence-fees",
      headers: authHeader(),
    });
    expect(res.statusCode).toBe(200);
  });
});
