/**
 * Fleet routes — integration tests (SVC-059).
 * Tests: fuel logs, trip logs, vehicle documents, driver roster, auth.
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { buildApp } from "../src/app.js";
import { signToken } from "@civitasone/auth";
import type { FastifyInstance } from "fastify";

const SECRET = "test_secret_for_civitasone_32chr";
const TENANT = "11111111-cccc-4000-8000-000000000001";
const ACTOR  = "22222222-cccc-4000-8000-000000000001";
const VEHICLE = "33333333-cccc-4000-8000-000000000001";
const DRIVER  = "44444444-cccc-4000-8000-000000000001";

function authHeader(roles = ["estab_admin", "fleet_officer", "super_admin"]) {
  const token = signToken({ sub: ACTOR, tid: TENANT, roles, sid: "s1" }, SECRET, 3600);
  return { authorization: `Bearer ${token}` };
}

let app: FastifyInstance;

beforeAll(async () => { app = await buildApp(); await app.ready(); });
afterAll(async () => { await app.close(); });

describe("Fuel Logs", () => {
  it("POST /v1/estab/fuel-logs → 202", async () => {
    const res = await app.inject({
      method: "POST", url: "/v1/estab/fuel-logs",
      headers: authHeader(),
      payload: {
        vehicleId: VEHICLE, logDate: "2026-07-20", fuelType: "diesel",
        litres: "45.50", costMinor: 475000, odometerKm: 52340, pumpName: "HP Sector 5",
      },
    });
    expect(res.statusCode).toBe(202);
  });

  it("POST /v1/estab/fuel-logs → 400 invalid fuelType", async () => {
    const res = await app.inject({
      method: "POST", url: "/v1/estab/fuel-logs",
      headers: authHeader(),
      payload: { vehicleId: VEHICLE, logDate: "2026-07-20", fuelType: "hydrogen", litres: "10", costMinor: 1000, odometerKm: 100 },
    });
    expect(res.statusCode).toBe(400);
  });

  it("POST /v1/estab/fuel-logs → 403 wrong role", async () => {
    const res = await app.inject({
      method: "POST", url: "/v1/estab/fuel-logs",
      headers: authHeader(["citizen"]),
      payload: { vehicleId: VEHICLE, logDate: "2026-07-20", fuelType: "diesel", litres: "10", costMinor: 1000, odometerKm: 100 },
    });
    expect(res.statusCode).toBe(403);
  });

  it("GET /v1/estab/fuel-logs → 200", async () => {
    const res = await app.inject({
      method: "GET", url: "/v1/estab/fuel-logs",
      headers: authHeader(),
    });
    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.body);
    expect(body.data).toBeInstanceOf(Array);
  });

  it("GET /v1/estab/fuel-logs?vehicleId=... → 200 filtered", async () => {
    const res = await app.inject({
      method: "GET", url: `/v1/estab/fuel-logs?vehicleId=${VEHICLE}`,
      headers: authHeader(),
    });
    expect(res.statusCode).toBe(200);
  });
});

describe("Trip Logs", () => {
  it("POST /v1/estab/trip-logs → 202", async () => {
    const res = await app.inject({
      method: "POST", url: "/v1/estab/trip-logs",
      headers: authHeader(),
      payload: {
        vehicleId: VEHICLE, driverId: DRIVER, tripDate: "2026-07-20",
        startOdometer: 52340, startTime: "2026-07-20T08:00:00Z",
        purpose: "District Collector office visit", route: "HQ → DC Office → HQ",
      },
    });
    expect(res.statusCode).toBe(202);
  });

  it("PATCH /v1/estab/trip-logs/:id/complete → 202", async () => {
    const fakeId = "55555555-cccc-4000-8000-000000000001";
    const res = await app.inject({
      method: "PATCH", url: `/v1/estab/trip-logs/${fakeId}/complete`,
      headers: authHeader(),
      payload: { endOdometer: 52380, endTime: "2026-07-20T12:00:00Z", version: 1 },
    });
    expect(res.statusCode).toBe(202);
  });

  it("GET /v1/estab/trip-logs → 200", async () => {
    const res = await app.inject({
      method: "GET", url: "/v1/estab/trip-logs",
      headers: authHeader(),
    });
    expect(res.statusCode).toBe(200);
  });

  it("GET /v1/estab/trip-logs → 401 no token", async () => {
    const res = await app.inject({ method: "GET", url: "/v1/estab/trip-logs" });
    expect(res.statusCode).toBe(401);
  });
});

describe("Vehicle Documents (permits/insurance/PUC/fitness)", () => {
  it("POST /v1/estab/vehicle-documents → 202", async () => {
    const res = await app.inject({
      method: "POST", url: "/v1/estab/vehicle-documents",
      headers: authHeader(),
      payload: {
        vehicleId: VEHICLE, docType: "insurance",
        validFrom: "2026-01-01", validUntil: "2027-01-01",
        issuer: "New India Assurance", amountMinor: 4500000,
      },
    });
    expect(res.statusCode).toBe(202);
  });

  it("POST /v1/estab/vehicle-documents → 400 invalid docType", async () => {
    const res = await app.inject({
      method: "POST", url: "/v1/estab/vehicle-documents",
      headers: authHeader(),
      payload: { vehicleId: VEHICLE, docType: "warranty", validFrom: "2026-01-01", validUntil: "2027-01-01" },
    });
    expect(res.statusCode).toBe(400);
  });

  it("GET /v1/estab/vehicle-documents → 200", async () => {
    const res = await app.inject({
      method: "GET", url: "/v1/estab/vehicle-documents",
      headers: authHeader(),
    });
    expect(res.statusCode).toBe(200);
  });
});

describe("Driver Roster", () => {
  it("POST /v1/estab/driver-roster → 202", async () => {
    const res = await app.inject({
      method: "POST", url: "/v1/estab/driver-roster",
      headers: authHeader(),
      payload: { driverId: DRIVER, vehicleId: VEHICLE, shiftDate: "2026-07-21", shiftType: "day" },
    });
    expect(res.statusCode).toBe(202);
  });

  it("GET /v1/estab/driver-roster → 200", async () => {
    const res = await app.inject({
      method: "GET", url: "/v1/estab/driver-roster",
      headers: authHeader(),
    });
    expect(res.statusCode).toBe(200);
  });

  it("POST /v1/estab/driver-roster → 400 invalid shiftType", async () => {
    const res = await app.inject({
      method: "POST", url: "/v1/estab/driver-roster",
      headers: authHeader(),
      payload: { driverId: DRIVER, shiftDate: "2026-07-21", shiftType: "graveyard" },
    });
    expect(res.statusCode).toBe(400);
  });
});
