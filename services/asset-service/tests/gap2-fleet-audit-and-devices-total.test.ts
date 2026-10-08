/**
 * GAP2-ASSETS-FLEET-SCHEMA-01 (LOW) + GAP2-ASSETS-FLEET-DEVICES-01 (LOW)
 *
 * SCHEMA-01: fleet tables gain the mandatory audit columns (updated_at,
 *   updated_by, version). Completing a maintenance job records the completing
 *   actor on the ROW (not just the audit event). On the old code these columns
 *   did not exist (schema + migration), so this test could not compile/pass.
 *
 * DEVICES-01: GET /fleet/devices returns a REAL total device count, not the
 *   current page size. On the old code `meta.total` was `rows.length` (<= limit).
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { randomUUID } from "node:crypto";
import { MemoryQueue } from "@civitasone/queue";
import { eq } from "drizzle-orm";
import { runWithTenant } from "@civitasone/db";
import { signToken } from "@civitasone/auth";
import type { FastifyInstance } from "fastify";
import { buildApp } from "../src/app.js";
import { db, sqlClient } from "../src/shared/db.js";
import { fleetVehicles, fleetDevices, fleetMaintenance } from "../src/modules/fleet/schema.js";
import { registerFleetConsumers } from "../src/modules/fleet/consumer.js";
import { COMMANDS } from "../src/topics.js";

const SECRET = process.env.JWT_SECRET ?? "test_secret_for_civitasone_32chr";

// Unique hex-only "…00000e0a<nn>" suffix for this file.
const TENANT = "11111111-aaaa-4000-8000-00000e0a0001";
const ACTOR  = "22222222-bbbb-4000-8000-00000e0a0001";
const COMPLETER = "33333333-cccc-4000-8000-00000e0a0001";
const VEHICLE = "44444444-dddd-4000-8000-00000e0a0001";

function token(tenantId: string, actorId: string) {
  return signToken({ sub: actorId, tid: tenantId, roles: ["asset_admin", "super_admin", "fleet_manager"], sid: "s-flt" }, SECRET, 3600);
}

type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0];
function asTenant<T>(tenantId: string, fn: (tx: Tx) => Promise<T>): Promise<T> {
  return runWithTenant(tenantId, () => db.transaction(fn)) as Promise<T>;
}

let app: FastifyInstance;

beforeAll(async () => {
  app = await buildApp();
  await app.ready();
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

describe("GAP2-ASSETS-FLEET-SCHEMA-01 — audit columns on fleet tables", () => {
  it("fleet_vehicles / fleet_maintenance expose updated_at, updated_by, version", async () => {
    // A tenant-scoped select of all drizzle-modelled columns must succeed; if
    // the migration/schema omitted the columns this throws (undefined column).
    const vrows = await asTenant(TENANT, (tx) => tx.select({
      updatedAt: fleetVehicles.updatedAt, updatedBy: fleetVehicles.updatedBy, version: fleetVehicles.version,
    }).from(fleetVehicles).limit(1));
    expect(Array.isArray(vrows)).toBe(true);
    const mrows = await asTenant(TENANT, (tx) => tx.select({
      updatedAt: fleetMaintenance.updatedAt, updatedBy: fleetMaintenance.updatedBy, version: fleetMaintenance.version,
    }).from(fleetMaintenance).limit(1));
    expect(Array.isArray(mrows)).toBe(true);
  });

  it("completing a maintenance job records the completing actor (updated_by) + version bump on the row", async () => {
    const q = new MemoryQueue();
    registerFleetConsumers(q);
    await q.start();

    // create a vehicle + scheduled maintenance (both created by ACTOR)
    await q.publish(COMMANDS.fleetCreate, {
      messageId: randomUUID(), type: COMMANDS.fleetCreate,
      tenantId: TENANT, actorId: ACTOR, correlationId: "c1", schemaVersion: "1.0",
      payload: { id: VEHICLE, tenantId: TENANT, registrationNo: "MH12FL0001", make: "Tata", model: "Ace", year: 2024, fuelType: "diesel" },
    });
    const maintId = randomUUID();
    await q.publish(COMMANDS.fleetScheduleMaintenance, {
      messageId: maintId, type: COMMANDS.fleetScheduleMaintenance,
      tenantId: TENANT, actorId: ACTOR, correlationId: "c2", schemaVersion: "1.0",
      payload: { id: maintId, tenantId: TENANT, vehicleId: VEHICLE, type: "oil_change", scheduledDate: new Date(Date.now() + 86400000).toISOString() },
    });
    await new Promise<void>((r) => setTimeout(r, 400));

    // complete it as a DIFFERENT actor (COMPLETER) → updated_by must be COMPLETER
    await q.publish(COMMANDS.fleetMaintenanceComplete, {
      messageId: randomUUID(), type: COMMANDS.fleetMaintenanceComplete,
      tenantId: TENANT, actorId: COMPLETER, correlationId: "c3", schemaVersion: "1.0",
      payload: { id: maintId, tenantId: TENANT, costMinor: 150000 },
    });
    await new Promise<void>((r) => setTimeout(r, 400));
    await q.stop();

    const rows = await asTenant(TENANT, (tx) => tx.select().from(fleetMaintenance).where(eq(fleetMaintenance.id, maintId)));
    expect(rows).toHaveLength(1);
    expect(rows[0]?.status).toBe("completed");
    expect(rows[0]?.updatedBy).toBe(COMPLETER); // the completing actor is on the row
    expect(rows[0]?.version).toBeGreaterThan(1); // version bumped on the mutation
  });
});

describe("GAP2-ASSETS-FLEET-DEVICES-01 — real total device count", () => {
  it("GET /fleet/devices?limit=2 returns total = full count (not the page size)", async () => {
    const q = new MemoryQueue();
    registerFleetConsumers(q);
    await q.start();
    // register 3 devices on the vehicle created above
    for (let i = 0; i < 3; i++) {
      const did = randomUUID();
      await q.publish(COMMANDS.fleetDeviceRegister, {
        messageId: did, type: COMMANDS.fleetDeviceRegister,
        tenantId: TENANT, actorId: ACTOR, correlationId: `d${i}`, schemaVersion: "1.0",
        payload: { id: did, tenantId: TENANT, vehicleId: VEHICLE, deviceImei: `12345678901234${i}`, protocol: "gt06" },
      });
    }
    await new Promise<void>((r) => setTimeout(r, 450));
    await q.stop();

    const res = await app.inject({
      method: "GET", url: "/v1/assets/fleet/devices?limit=2",
      headers: { authorization: `Bearer ${token(TENANT, ACTOR)}` },
    });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.data).toHaveLength(2);      // page capped at the limit
    expect(body.total).toBe(3);             // but total is the real count
    expect(body.limit).toBe(2);
  });
});
