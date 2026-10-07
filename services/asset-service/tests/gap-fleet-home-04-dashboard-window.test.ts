/**
 * GAP-FLEET-HOME-04: the web KPI "Due Maintenance (7d)" maps to the dashboard's
 * `scheduledMaintenance` figure. This test pins down what that figure actually
 * counts in asset-service, so the 7-day label is verified against the backend
 * (not just asserted in the UI copy): a scheduled job due within the next 7
 * days counts in `scheduledMaintenance`; one already past its date counts in
 * `overdueMaintenance`; one more than 7 days out counts in NEITHER. Real
 * Postgres, no mocks, with dates computed relative to "today" so the window is
 * exercised regardless of when the suite runs.
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import { runWithTenant } from "@civitasone/db";
import { buildApp } from "../src/app.js";
import { db, sqlClient } from "../src/shared/db.js";
import { fleetMaintenance, fleetVehicles } from "../src/modules/fleet/schema.js";
import { getFleetDashboard } from "../src/modules/fleet/repo.js";
import type { FastifyInstance } from "fastify";

const TENANT = randomUUID();
const ACTOR = randomUUID();
let app: FastifyInstance;

type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0];
const asTenant = <T,>(fn: (tx: Tx) => Promise<T>): Promise<T> =>
  runWithTenant(TENANT, () => db.transaction(fn)) as Promise<T>;

/** "YYYY-MM-DD" `days` from today (UTC calendar), matching the scheduled_date date column. */
function dayOffset(days: number): string {
  const d = new Date();
  d.setUTCHours(0, 0, 0, 0);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

beforeAll(async () => {
  app = await buildApp();
  await app.ready();
  const v = randomUUID();
  await asTenant(async (tx) => {
    await tx.insert(fleetVehicles).values({ id: v, tenantId: TENANT, registrationNo: "KA07WIN0001", status: "active", createdBy: ACTOR });
    await tx.insert(fleetMaintenance).values([
      // Two due within 7 days -> scheduledMaintenance
      { tenantId: TENANT, vehicleId: v, type: "service", scheduledDate: dayOffset(3), status: "scheduled" },
      { tenantId: TENANT, vehicleId: v, type: "tyres",   scheduledDate: dayOffset(6), status: "scheduled" },
      // One already overdue -> overdueMaintenance (NOT scheduledMaintenance)
      { tenantId: TENANT, vehicleId: v, type: "brakes",  scheduledDate: dayOffset(-2), status: "scheduled" },
      // One more than 7 days out -> counted in NEITHER bucket
      { tenantId: TENANT, vehicleId: v, type: "battery", scheduledDate: dayOffset(30), status: "scheduled" },
      // A completed job within the window must never count (status filter)
      { tenantId: TENANT, vehicleId: v, type: "wash",    scheduledDate: dayOffset(2), status: "completed" },
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

describe("getFleetDashboard scheduledMaintenance window (GAP-FLEET-HOME-04)", () => {
  it("counts only jobs due within the next 7 days as scheduledMaintenance", async () => {
    const stats = await runWithTenant(TENANT, () => getFleetDashboard(TENANT));
    expect(stats.scheduledMaintenance).toBe(2); // the +3d and +6d scheduled jobs
    expect(stats.overdueMaintenance).toBe(1);    // the -2d scheduled job
    // the +30d job is in neither bucket; the completed job is excluded entirely
  });
});
