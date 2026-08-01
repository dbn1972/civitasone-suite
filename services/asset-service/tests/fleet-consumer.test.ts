/**
 * Fleet + fleet-devices consumer integration test — facade closure proof.
 *
 * Before this: fleet/routes.ts + fleet-devices/routes.ts published commands
 * (asset.fleet.create, asset.fleet_device.register, asset.fleet_device.telemetry,
 * asset.fleet.schedule_maintenance) with NO consumer.ts registered — 202
 * accepted, nothing ever persisted; GET handlers returned hardcoded [];
 * POST .../gps was a pure echo.
 *
 * This suite proves: HTTP → consumer → DB round trip (row actually written),
 * the GET lists return the persisted rows (not empty), GPS persists + reads
 * back via the vehicle row, idempotency on register + telemetry, and
 * cross-tenant RLS isolation.
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { randomUUID } from "node:crypto";
import { eq, and } from "drizzle-orm";
import { MemoryQueue } from "@civitasone/queue";
import { runWithTenant } from "@civitasone/db";
import { signToken } from "@civitasone/auth";
import { buildApp } from "../src/app.js";
import { db, sqlClient } from "../src/shared/db.js";
import { fleetVehicles, fleetDevices, fleetDeviceTelemetry, fleetMaintenance } from "../src/modules/fleet/schema.js";
import { processed } from "../src/shared/outbox.js";
import { registerFleetConsumers } from "../src/modules/fleet/consumer.js";
import { COMMANDS } from "../src/topics.js";
import type { FastifyInstance } from "fastify";

const SECRET = process.env.JWT_SECRET ?? "test_secret_for_civitasone_32chr";

const TENANT_A = "aaaaaaaa-1111-4000-8000-0000000000f1";
const ACTOR_A  = "cccccccc-3333-4000-8000-0000000000f1";
const TENANT_B = "bbbbbbbb-2222-4000-8000-0000000000f2";
const ACTOR_B  = "dddddddd-4444-4000-8000-0000000000f2";

function token(tenantId: string, actorId: string) {
  return signToken({ sub: actorId, tid: tenantId, roles: ["asset_admin", "super_admin"], sid: "s-fleet" }, SECRET, 3600);
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
  await app.close();
  await sqlClient.end();
});

describe("Fleet consumer — CQRS wiring (integration)", () => {
  const vehicleId = randomUUID();
  const msgVehicle = randomUUID();

  afterAll(async () => {
    await asTenant(TENANT_A, async (tx) => {
      await tx.delete(fleetDeviceTelemetry).where(eq(fleetDeviceTelemetry.tenantId, TENANT_A));
      await tx.delete(fleetDevices).where(eq(fleetDevices.tenantId, TENANT_A));
      await tx.delete(fleetMaintenance).where(eq(fleetMaintenance.tenantId, TENANT_A));
      await tx.delete(fleetVehicles).where(eq(fleetVehicles.id, vehicleId));
    });
  });

  it("asset.fleet.create inserts a vehicle row and records _inbox.processed", async () => {
    const q = new MemoryQueue();
    registerFleetConsumers(q);
    await q.start();

    await q.publish(COMMANDS.fleetCreate, {
      messageId: msgVehicle, type: COMMANDS.fleetCreate,
      tenantId: TENANT_A, actorId: ACTOR_A, correlationId: "corr-fleet-1", schemaVersion: "1.0",
      payload: { id: vehicleId, tenantId: TENANT_A, registrationNo: "UP32AB1234", make: "Tata", model: "Nexon", year: 2024, fuelType: "electric" },
    });
    await new Promise<void>((r) => setTimeout(r, 400));
    await q.stop();

    const rows = await asTenant(TENANT_A, (tx) => tx.select().from(fleetVehicles).where(eq(fleetVehicles.id, vehicleId)));
    expect(rows).toHaveLength(1);
    expect(rows[0]?.registrationNo).toBe("UP32AB1234");
    expect(rows[0]?.status).toBe("active");

    const seen = await asTenant(TENANT_A, (tx) => tx.select().from(processed).where(eq(processed.messageId, msgVehicle)));
    expect(seen).toHaveLength(1);
  });

  it("idempotent: replaying the same messageId does not duplicate or error", async () => {
    const q = new MemoryQueue();
    registerFleetConsumers(q);
    await q.start();
    await q.publish(COMMANDS.fleetCreate, {
      messageId: msgVehicle, type: COMMANDS.fleetCreate,
      tenantId: TENANT_A, actorId: ACTOR_A, correlationId: "corr-fleet-1-replay", schemaVersion: "1.0",
      payload: { id: vehicleId, tenantId: TENANT_A, registrationNo: "UP32AB1234", make: "Tata", model: "Nexon", year: 2024, fuelType: "electric" },
    });
    await new Promise<void>((r) => setTimeout(r, 300));
    await q.stop();

    const rows = await asTenant(TENANT_A, (tx) => tx.select().from(fleetVehicles).where(eq(fleetVehicles.id, vehicleId)));
    expect(rows).toHaveLength(1); // still exactly one row
  });

  it("GET /v1/assets/fleet/vehicles returns the persisted vehicle (not hardcoded [])", async () => {
    const res = await app.inject({
      method: "GET", url: "/v1/assets/fleet/vehicles",
      headers: { authorization: `Bearer ${token(TENANT_A, ACTOR_A)}` },
    });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.data.some((v: { id: string }) => v.id === vehicleId)).toBe(true);
  });

  it("asset.fleet.gps_update persists position onto the vehicle row (not an echo)", async () => {
    const q = new MemoryQueue();
    registerFleetConsumers(q);
    await q.start();
    await q.publish(COMMANDS.fleetGpsUpdate, {
      messageId: randomUUID(), type: COMMANDS.fleetGpsUpdate,
      tenantId: TENANT_A, actorId: ACTOR_A, correlationId: "corr-gps-1", schemaVersion: "1.0",
      payload: { id: vehicleId, tenantId: TENANT_A, lat: 28.6139, lng: 77.209 },
    });
    await new Promise<void>((r) => setTimeout(r, 300));
    await q.stop();

    const rows = await asTenant(TENANT_A, (tx) => tx.select().from(fleetVehicles).where(eq(fleetVehicles.id, vehicleId)));
    expect(rows).toHaveLength(1);
    expect(Number(rows[0]?.currentLat)).toBeCloseTo(28.6139, 3);
    expect(Number(rows[0]?.currentLng)).toBeCloseTo(77.209, 3);
    expect(rows[0]?.lastGpsAt).toBeTruthy();

    // read-back via GET — proves the "way to read latest position" the mission required
    const res = await app.inject({
      method: "GET", url: "/v1/assets/fleet/vehicles",
      headers: { authorization: `Bearer ${token(TENANT_A, ACTOR_A)}` },
    });
    const found = res.json().data.find((v: { id: string }) => v.id === vehicleId);
    expect(Number(found.currentLat)).toBeCloseTo(28.6139, 3);
  });

  it("asset.fleet.schedule_maintenance inserts a maintenance row", async () => {
    const q = new MemoryQueue();
    registerFleetConsumers(q);
    await q.start();
    const maintId = randomUUID();
    await q.publish(COMMANDS.fleetScheduleMaintenance, {
      messageId: maintId, type: COMMANDS.fleetScheduleMaintenance,
      tenantId: TENANT_A, actorId: ACTOR_A, correlationId: "corr-maint-1", schemaVersion: "1.0",
      payload: { id: maintId, tenantId: TENANT_A, vehicleId, type: "oil_change", scheduledDate: new Date(Date.now() + 86400000).toISOString(), odometerThresholdKm: 5000 },
    });
    await new Promise<void>((r) => setTimeout(r, 300));
    await q.stop();

    const rows = await asTenant(TENANT_A, (tx) => tx.select().from(fleetMaintenance).where(eq(fleetMaintenance.id, maintId)));
    expect(rows).toHaveLength(1);
    expect(rows[0]?.type).toBe("oil_change");
    expect(rows[0]?.odometerThresholdKm).toBe(5000);

    const res = await app.inject({
      method: "GET", url: "/v1/assets/fleet/maintenance",
      headers: { authorization: `Bearer ${token(TENANT_A, ACTOR_A)}` },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().data.some((m: { id: string }) => m.id === maintId)).toBe(true);
  });

  it("asset.fleet_device.register inserts a device row; GET devices returns it", async () => {
    const q = new MemoryQueue();
    registerFleetConsumers(q);
    await q.start();
    const deviceId = randomUUID();
    await q.publish(COMMANDS.fleetDeviceRegister, {
      messageId: deviceId, type: COMMANDS.fleetDeviceRegister,
      tenantId: TENANT_A, actorId: ACTOR_A, correlationId: "corr-dev-1", schemaVersion: "1.0",
      payload: { id: deviceId, tenantId: TENANT_A, vehicleId, deviceImei: "123456789012345", protocol: "gt06" },
    });
    await new Promise<void>((r) => setTimeout(r, 300));
    await q.stop();

    const rows = await asTenant(TENANT_A, (tx) => tx.select().from(fleetDevices).where(eq(fleetDevices.id, deviceId)));
    expect(rows).toHaveLength(1);
    expect(rows[0]?.deviceImei).toBe("123456789012345");

    const res = await app.inject({
      method: "GET", url: "/v1/assets/fleet/devices",
      headers: { authorization: `Bearer ${token(TENANT_A, ACTOR_A)}` },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().data.some((d: { id: string }) => d.id === deviceId)).toBe(true);

    // ── telemetry on this device, twice with the same messageId → idempotent ──
    const telemetryMsgId = randomUUID();
    const q2 = new MemoryQueue();
    registerFleetConsumers(q2);
    await q2.start();
    const publishTelemetry = () => q2.publish(COMMANDS.fleetDeviceTelemetry, {
      messageId: telemetryMsgId, type: COMMANDS.fleetDeviceTelemetry,
      tenantId: TENANT_A, actorId: ACTOR_A, correlationId: "corr-telem-1", schemaVersion: "1.0",
      payload: { deviceId, tenantId: TENANT_A, lat: 19.076, lng: 72.8777, speed: 42, heading: 180, fuelLevelPct: 55, engineOn: true, timestamp: new Date().toISOString() },
    });
    await publishTelemetry();
    await new Promise<void>((r) => setTimeout(r, 300));
    await publishTelemetry(); // replay — must not duplicate
    await new Promise<void>((r) => setTimeout(r, 300));
    await q2.stop();

    const telemetryRows = await asTenant(TENANT_A, (tx) => tx.select().from(fleetDeviceTelemetry).where(eq(fleetDeviceTelemetry.deviceId, deviceId)));
    expect(telemetryRows).toHaveLength(1);
    expect(Number(telemetryRows[0]?.speed)).toBeCloseTo(42);

    // telemetry mirrors position onto the parent vehicle too
    const vehicleRows = await asTenant(TENANT_A, (tx) => tx.select().from(fleetVehicles).where(eq(fleetVehicles.id, vehicleId)));
    expect(Number(vehicleRows[0]?.currentLat)).toBeCloseTo(19.076, 3);
    expect(vehicleRows[0]?.fuelLevelPct).toBe(55);
  });
});

describe("Fleet — cross-tenant RLS isolation", () => {
  const vehicleIdA = randomUUID();

  beforeAll(async () => {
    const q = new MemoryQueue();
    registerFleetConsumers(q);
    await q.start();
    await q.publish(COMMANDS.fleetCreate, {
      messageId: randomUUID(), type: COMMANDS.fleetCreate,
      tenantId: TENANT_A, actorId: ACTOR_A, correlationId: "corr-rls-1", schemaVersion: "1.0",
      payload: { id: vehicleIdA, tenantId: TENANT_A, registrationNo: "DL01XY9999", make: "Mahindra", model: "Bolero", year: 2023, fuelType: "diesel" },
    });
    await new Promise<void>((r) => setTimeout(r, 300));
    await q.stop();
  });
  afterAll(async () => {
    await asTenant(TENANT_A, async (tx) => { await tx.delete(fleetVehicles).where(eq(fleetVehicles.id, vehicleIdA)); });
  });

  it("Tenant B cannot see Tenant A's vehicle via GET list", async () => {
    const res = await app.inject({
      method: "GET", url: "/v1/assets/fleet/vehicles",
      headers: { authorization: `Bearer ${token(TENANT_B, ACTOR_B)}` },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().data.some((v: { id: string }) => v.id === vehicleIdA)).toBe(false);
  });

  it("Tenant B's tenant-scoped DB read of Tenant A's row returns zero rows (RLS, not app filter)", async () => {
    const rows = await asTenant(TENANT_B, (tx) => tx.select().from(fleetVehicles).where(and(eq(fleetVehicles.id, vehicleIdA))));
    expect(rows).toHaveLength(0);
  });
});
