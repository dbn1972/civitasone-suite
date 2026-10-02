/**
 * ml-assets-02 gap batch -- fleet backend changes.
 *   GAP-ASSETS-FLEET-VEHICLES-05  duplicate registration -> 409
 *   GAP-ASSETS-FLEET-VEHICLES-06  GPS response carries updatedAt
 *   GAP-ASSETS-FLEET-VEHICLES-07  role contract for fleet reads/writes (pinned)
 *   GAP-ASSETS-FLEET-MAINTENANCE-05  cancel route + consumer; complete/cancel guards
 *   GAP-ASSETS-FLEET-DEVICES-05/06   telemetry future-dated reading + IMEI/ICCID digits
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import { MemoryQueue } from "@civitasone/queue";
import { runWithTenant } from "@civitasone/db";
import { signToken } from "@civitasone/auth";
import { buildApp } from "../src/app.js";
import { db, sqlClient } from "../src/shared/db.js";
import { fleetVehicles, fleetMaintenance, fleetDevices } from "../src/modules/fleet/schema.js";
import * as repo from "../src/modules/fleet/repo.js";
import { registerFleetConsumers } from "../src/modules/fleet/consumer.js";
import { COMMANDS } from "../src/topics.js";
import type { FastifyInstance } from "fastify";

const SECRET = process.env.JWT_SECRET ?? "test_secret_for_civitasone_32chr";
const TENANT = "aaaaaaaa-1111-4000-8000-0000000000e2";
const TENANT_OTHER = "bbbbbbbb-2222-4000-8000-0000000000e2";
const ACTOR = "cccccccc-3333-4000-8000-0000000000e2";

const tok = (roles: string[], tid = TENANT) => signToken({ sub: ACTOR, tid, roles, sid: "s-ml02" }, SECRET, 3600);
const admin = () => tok(["asset_admin"]);

type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0];
function asTenant<T>(tenantId: string, fn: (tx: Tx) => Promise<T>): Promise<T> {
  return runWithTenant(tenantId, () => db.transaction(fn)) as Promise<T>;
}

let app: FastifyInstance;
const vehicleId = randomUUID();
const openJob = randomUUID();
const doneJob = randomUUID();
const cancelledJob = randomUUID();
const deviceId = randomUUID();

beforeAll(async () => {
  app = await buildApp();
  await app.ready();
  await asTenant(TENANT, async (tx) => {
    await repo.insertVehicle(tx, {
      id: vehicleId, tenantId: TENANT, registrationNo: "DL-01-AB-1234", make: "Tata", model: "Sumo",
      year: 2020, fuelType: "diesel", status: "active", createdBy: ACTOR,
    });
    await repo.insertDevice(tx, { id: deviceId, tenantId: TENANT, vehicleId, deviceImei: "490154203237518", protocol: "gt06", simIccid: null, status: "active", createdBy: ACTOR });
    for (const [id, status] of [[openJob, "scheduled"], [doneJob, "completed"], [cancelledJob, "cancelled"]] as const) {
      await repo.insertMaintenance(tx, {
        id, tenantId: TENANT, vehicleId, type: "oil_change", scheduledDate: "2026-10-05", status,
        costMinor: null, odometerThresholdKm: null, createdBy: ACTOR,
      });
    }
  });
});

afterAll(async () => {
  await asTenant(TENANT, async (tx) => {
    await tx.delete(fleetMaintenance).where(eq(fleetMaintenance.tenantId, TENANT));
    await tx.delete(fleetDevices).where(eq(fleetDevices.tenantId, TENANT));
    await tx.delete(fleetVehicles).where(eq(fleetVehicles.tenantId, TENANT));
  });
  await app.close();
  await sqlClient.end();
});

const hit = (method: "GET" | "POST" | "PATCH", url: string, token: string, payload?: unknown) =>
  app.inject({ method, url, headers: { authorization: `Bearer ${token}` }, ...(payload !== undefined ? { payload: payload as object } : {}) });

describe("GAP-ASSETS-FLEET-VEHICLES-05 duplicate registration", () => {
  it("rejects a plate that matches an existing vehicle ignoring case, spaces and hyphens", async () => {
    for (const reg of ["DL01AB1234", "dl 01 ab 1234", "DL-01-AB-1234"]) {
      const res = await hit("POST", "/v1/assets/fleet/vehicles", admin(), { registrationNo: reg, make: "Tata", model: "Sumo", year: 2021, fuelType: "diesel" });
      expect(res.statusCode, reg).toBe(409);
      expect(res.json().code).toBe("DUPLICATE_REGISTRATION");
    }
  });

  it("accepts a new plate, and the same plate under another tenant", async () => {
    const fresh = await hit("POST", "/v1/assets/fleet/vehicles", admin(), { registrationNo: "OD02AB1234", make: "Tata", model: "Sumo", year: 2021, fuelType: "cng" });
    expect(fresh.statusCode).toBe(202);
    const other = await hit("POST", "/v1/assets/fleet/vehicles", tok(["asset_admin"], TENANT_OTHER), { registrationNo: "DL01AB1234", make: "Tata", model: "Sumo", year: 2021, fuelType: "diesel" });
    expect(other.statusCode).toBe(202);
  });
});

describe("GAP-ASSETS-FLEET-VEHICLES-06 GPS response", () => {
  it("echoes an ISO updatedAt so the UI never prints 'undefined'", async () => {
    const res = await hit("POST", `/v1/assets/fleet/vehicles/${vehicleId}/gps`, admin(), { lat: 28.6, lng: 77.2 });
    expect(res.statusCode).toBe(202);
    expect(Number.isNaN(Date.parse(res.json().data.updatedAt))).toBe(false);
  });
});

describe("GAP-ASSETS-FLEET-VEHICLES-07 role contract", () => {
  it("reads: elevated fleet/audit roles only; a plain office role is refused", async () => {
    for (const role of ["super_admin", "asset_admin", "fleet_manager", "audit_officer"]) {
      expect((await hit("GET", "/v1/assets/fleet/vehicles", tok([role]))).statusCode, role).toBe(200);
    }
    for (const role of ["employee", "asset_clerk", "citizen"]) {
      expect((await hit("GET", "/v1/assets/fleet/vehicles", tok([role]))).statusCode, role).toBe(403);
      expect((await hit("GET", `/v1/assets/fleet/vehicles/${vehicleId}`, tok([role]))).statusCode, role).toBe(403);
    }
  });

  it("writes (incl. GPS position) are refused to the read-only audit role", async () => {
    const gps = await hit("POST", `/v1/assets/fleet/vehicles/${vehicleId}/gps`, tok(["audit_officer"]), { lat: 1, lng: 2 });
    expect(gps.statusCode).toBe(403);
    const reg = await hit("POST", "/v1/assets/fleet/vehicles", tok(["audit_officer"]), { registrationNo: "MH12AB9999", make: "a", model: "b", year: 2020, fuelType: "diesel" });
    expect(reg.statusCode).toBe(403);
  });
});

describe("GAP-ASSETS-FLEET-MAINTENANCE-05 complete / cancel", () => {
  it("cancel is refused for a non-admin and for a missing job", async () => {
    expect((await hit("PATCH", `/v1/assets/fleet/maintenance/${openJob}/cancel`, tok(["audit_officer"]), {})).statusCode).toBe(403);
    expect((await hit("PATCH", `/v1/assets/fleet/maintenance/${randomUUID()}/cancel`, admin(), {})).statusCode).toBe(404);
  });

  it("state guards: completed cannot be cancelled, cancelled cannot be completed or re-cancelled", async () => {
    const c1 = await hit("PATCH", `/v1/assets/fleet/maintenance/${doneJob}/cancel`, admin(), {});
    expect(c1.statusCode).toBe(409);
    expect(c1.json().code).toBe("ALREADY_COMPLETED");
    const c2 = await hit("PATCH", `/v1/assets/fleet/maintenance/${cancelledJob}/cancel`, admin(), {});
    expect(c2.statusCode).toBe(409);
    expect(c2.json().code).toBe("ALREADY_CANCELLED");
    const c3 = await hit("PATCH", `/v1/assets/fleet/maintenance/${cancelledJob}/complete`, admin(), {});
    expect(c3.statusCode).toBe(409);
    expect(c3.json().code).toBe("ALREADY_CANCELLED");
  });

  it("cancelling an open job is accepted, and the consumer persists status=cancelled (audited once)", async () => {
    const res = await hit("PATCH", `/v1/assets/fleet/maintenance/${openJob}/cancel`, admin(), {});
    expect(res.statusCode).toBe(202);

    const q = new MemoryQueue();
    registerFleetConsumers(q);
    await q.start();
    await q.publish(COMMANDS.fleetMaintenanceCancel, {
      messageId: randomUUID(), type: COMMANDS.fleetMaintenanceCancel,
      tenantId: TENANT, actorId: ACTOR, correlationId: "corr-ml02-cancel", schemaVersion: "1.0",
      payload: { id: openJob, tenantId: TENANT },
    });
    await new Promise<void>((r) => setTimeout(r, 400));
    await q.stop();

    const row = await runWithTenant(TENANT, () => repo.findMaintenanceById(openJob, TENANT));
    expect(row?.status).toBe("cancelled");
  });

  it("the consumer never overwrites a completed job with cancelled", async () => {
    const q = new MemoryQueue();
    registerFleetConsumers(q);
    await q.start();
    await q.publish(COMMANDS.fleetMaintenanceCancel, {
      messageId: randomUUID(), type: COMMANDS.fleetMaintenanceCancel,
      tenantId: TENANT, actorId: ACTOR, correlationId: "corr-ml02-cancel-done", schemaVersion: "1.0",
      payload: { id: doneJob, tenantId: TENANT },
    });
    await new Promise<void>((r) => setTimeout(r, 400));
    await q.stop();
    expect((await runWithTenant(TENANT, () => repo.findMaintenanceById(doneJob, TENANT)))?.status).toBe("completed");
  });
});

describe("GAP-ASSETS-FLEET-DEVICES-05/06 device payload validation", () => {
  const dev = { vehicleId, protocol: "gt06" } as const;

  it("rejects an IMEI that is not 15 digits, and an ICCID with letters", async () => {
    expect((await hit("POST", "/v1/assets/fleet/devices", admin(), { ...dev, deviceImei: "abcdefghijklmno" })).statusCode).toBe(400);
    expect((await hit("POST", "/v1/assets/fleet/devices", admin(), { ...dev, deviceImei: "49015420323751" })).statusCode).toBe(400);
    expect((await hit("POST", "/v1/assets/fleet/devices", admin(), { ...dev, deviceImei: "490154203237518", simIccid: "89910000000000000AB" })).statusCode).toBe(400);
  });

  it("accepts a 15-digit IMEI with an optional 19/20-digit ICCID", async () => {
    expect((await hit("POST", "/v1/assets/fleet/devices", admin(), { ...dev, deviceImei: "490154203237518", simIccid: "8991000000000000000" })).statusCode).toBe(202);
    expect((await hit("POST", "/v1/assets/fleet/devices", admin(), { ...dev, deviceImei: "490154203237518" })).statusCode).toBe(202);
  });

  it("rejects a future-dated telemetry reading but accepts a back-dated one", async () => {
    const url = `/v1/assets/fleet/devices/${deviceId}/telemetry`;
    const base = { lat: 28.6, lng: 77.2, speed: 10, heading: 90 };
    const future = new Date(Date.now() + 3_600_000).toISOString();
    const past = new Date(Date.now() - 3_600_000).toISOString();
    expect((await hit("POST", url, admin(), { ...base, timestamp: future })).statusCode).toBe(400);
    expect((await hit("POST", url, admin(), { ...base, timestamp: past })).statusCode).toBe(202);
  });
});
