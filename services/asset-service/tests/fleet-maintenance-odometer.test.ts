/**
 * fleet_maintenance.odometer_threshold_km used to be stored but never evaluated:
 * only the date made a job overdue. Real Postgres, no mocks: a scheduled job whose
 * vehicle odometer has reached the threshold is reported odometerExceeded by the
 * maintenance list and counted in the dashboard's overdueMaintenance, whatever its date.
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import { runWithTenant } from "@civitasone/db";
import { signToken } from "@civitasone/auth";
import { buildApp } from "../src/app.js";
import { db, sqlClient } from "../src/shared/db.js";
import { fleetMaintenance, fleetVehicles } from "../src/modules/fleet/schema.js";
import { getFleetDashboard, isOdometerExceeded } from "../src/modules/fleet/repo.js";
import type { FastifyInstance } from "fastify";

const SECRET = process.env.JWT_SECRET ?? "test_secret_for_civitasone_32chr";
const TENANT = randomUUID();
const ACTOR = randomUUID();
let app: FastifyInstance;
const token = () => signToken({ sub: ACTOR, tid: TENANT, roles: ["fleet_manager"], sid: "s-fleet-odo" }, SECRET, 3600);

type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0];
const asTenant = <T,>(fn: (tx: Tx) => Promise<T>): Promise<T> => runWithTenant(TENANT, () => db.transaction(fn)) as Promise<T>;

function dayOffset(days: number): string {
  const d = new Date();
  d.setUTCHours(0, 0, 0, 0);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

const FUTURE_REACHED = randomUUID();   // threshold reached, date still in the future -> overdue
const FUTURE_NOT_REACHED = randomUUID();
const FUTURE_NO_THRESHOLD = randomUUID();
const DONE_REACHED = randomUUID();     // completed: never flagged
const NO_ODOMETER_VEHICLE_JOB = randomUUID();

beforeAll(async () => {
  app = await buildApp();
  await app.ready();
  const v = randomUUID();
  const vNoOdo = randomUUID();
  await asTenant(async (tx) => {
    await tx.insert(fleetVehicles).values([
      { id: v, tenantId: TENANT, registrationNo: "KA01ODO0001", odometerKm: 12000, createdBy: ACTOR },
      { id: vNoOdo, tenantId: TENANT, registrationNo: "KA01ODO0002", createdBy: ACTOR },
    ]);
    await tx.insert(fleetMaintenance).values([
      { id: FUTURE_REACHED, tenantId: TENANT, vehicleId: v, type: "oil_change", scheduledDate: dayOffset(30), status: "scheduled", odometerThresholdKm: 10000 },
      { id: FUTURE_NOT_REACHED, tenantId: TENANT, vehicleId: v, type: "tire_rotation", scheduledDate: dayOffset(30), status: "scheduled", odometerThresholdKm: 20000 },
      { id: FUTURE_NO_THRESHOLD, tenantId: TENANT, vehicleId: v, type: "battery_check", scheduledDate: dayOffset(30), status: "scheduled" },
      { id: DONE_REACHED, tenantId: TENANT, vehicleId: v, type: "full_service", scheduledDate: dayOffset(30), status: "completed", odometerThresholdKm: 10000 },
      { id: NO_ODOMETER_VEHICLE_JOB, tenantId: TENANT, vehicleId: vNoOdo, type: "oil_change", scheduledDate: dayOffset(30), status: "scheduled", odometerThresholdKm: 100 },
    ]);
  });
});

afterAll(async () => {
  await asTenant(async (tx) => {
    await tx.delete(fleetMaintenance).where(eq(fleetMaintenance.tenantId, TENANT));
    await tx.delete(fleetVehicles).where(eq(fleetVehicles.tenantId, TENANT));
  });
  await app.close();
  await sqlClient.end();
});

describe("isOdometerExceeded", () => {
  it("needs a scheduled job, a threshold and a reading that has reached it", () => {
    expect(isOdometerExceeded("scheduled", 10000, 10000)).toBe(true);
    expect(isOdometerExceeded("scheduled", 10000, 9999)).toBe(false);
    expect(isOdometerExceeded("scheduled", null, 99999)).toBe(false);
    expect(isOdometerExceeded("scheduled", 100, null)).toBe(false);
    expect(isOdometerExceeded("completed", 100, 99999)).toBe(false);
    expect(isOdometerExceeded("cancelled", 100, 99999)).toBe(false);
  });
});

describe("maintenance list + dashboard evaluate odometerThresholdKm", () => {
  it("GET /v1/assets/fleet/maintenance reports odometerExceeded per job", async () => {
    const res = await app.inject({ method: "GET", url: "/v1/assets/fleet/maintenance", headers: { authorization: `Bearer ${token()}`, "x-tenant-id": TENANT } });
    expect(res.statusCode).toBe(200);
    const rows = res.json().data as Array<{ id: string; odometerExceeded: boolean }>;
    const flag = (id: string) => rows.find((r) => r.id === id)?.odometerExceeded;
    expect(flag(FUTURE_REACHED)).toBe(true);
    expect(flag(FUTURE_NOT_REACHED)).toBe(false);
    expect(flag(FUTURE_NO_THRESHOLD)).toBe(false);
    expect(flag(DONE_REACHED)).toBe(false);
    expect(flag(NO_ODOMETER_VEHICLE_JOB)).toBe(false);
  });

  it("the dashboard counts only the odometer-reached scheduled job as overdue (all dates are 30 days out)", async () => {
    const stats = await runWithTenant(TENANT, () => getFleetDashboard(TENANT));
    expect(stats.overdueMaintenance).toBe(1);
    expect(stats.scheduledMaintenance).toBe(0); // nothing else is due within 7 days
  });
});
