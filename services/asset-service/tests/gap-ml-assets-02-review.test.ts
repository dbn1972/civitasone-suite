/**
 * ml-assets-02 review fixes:
 *  - unique plate index (+ consumer maps unique violation, PATCH duplicate check)
 *  - telemetry never moves the live position backwards; audit carries recordedAt/lat/lng/backdated
 *  - complete consumer is conditional on status=scheduled and audits only on change
 *  - telemetry route 404s for an unknown device
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { randomUUID } from "node:crypto";
import { and, eq } from "drizzle-orm";
import { MemoryQueue } from "@civitasone/queue";
import { runWithTenant } from "@civitasone/db";
import { signToken } from "@civitasone/auth";
import { buildApp } from "../src/app.js";
import { db, sqlClient } from "../src/shared/db.js";
import { fleetVehicles, fleetMaintenance, fleetDevices, fleetDeviceTelemetry } from "../src/modules/fleet/schema.js";
import { outboxMessages } from "../src/shared/outbox.js";
import * as repo from "../src/modules/fleet/repo.js";
import { registerFleetConsumers } from "../src/modules/fleet/consumer.js";
import { COMMANDS } from "../src/topics.js";
import type { FastifyInstance } from "fastify";

const SECRET = process.env.JWT_SECRET ?? "test_secret_for_civitasone_32chr";
const TENANT = "aaaaaaaa-1111-4000-8000-0000000000e3";
const ACTOR = "cccccccc-3333-4000-8000-0000000000e3";
const admin = () => signToken({ sub: ACTOR, tid: TENANT, roles: ["asset_admin"], sid: "s-ml02r" }, SECRET, 3600);

type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0];
const asTenant = <T,>(fn: (tx: Tx) => Promise<T>): Promise<T> => runWithTenant(TENANT, () => db.transaction(fn)) as Promise<T>;
const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

let app: FastifyInstance;
const vehicleId = randomUUID();
const deviceId = randomUUID();
const jobA = randomUUID();
const vehicle = (id: string, plate: string, status = "active") => ({
  id, tenantId: TENANT, registrationNo: plate, make: "Tata", model: "Sumo", year: 2020, fuelType: "diesel", status, createdBy: ACTOR,
});

async function run(topic: string, payload: Record<string, unknown>, messageId = randomUUID()) {
  const q = new MemoryQueue();
  registerFleetConsumers(q);
  await q.start();
  await q.publish(topic, { messageId, type: topic, tenantId: TENANT, actorId: ACTOR, correlationId: `corr-${messageId}`, schemaVersion: "1.0", payload });
  await sleep(500);
  await q.stop();
}
const auditsFor = (resourceId: string) =>
  asTenant((tx) => tx.select().from(outboxMessages).where(and(eq(outboxMessages.tenantId, TENANT), eq(outboxMessages.topic, "audit.event.record"))))
    .then((rows) => rows.filter((r) => r.payload.resourceId === resourceId));

beforeAll(async () => {
  app = await buildApp();
  await app.ready();
  await asTenant(async (tx) => {
    await repo.insertVehicle(tx, vehicle(vehicleId, "KA01AB1111"));
    await repo.insertDevice(tx, { id: deviceId, tenantId: TENANT, vehicleId, deviceImei: "490154203237518", protocol: "gt06", simIccid: null, status: "active", createdBy: ACTOR });
    await repo.insertMaintenance(tx, { id: jobA, tenantId: TENANT, vehicleId, type: "oil_change", scheduledDate: "2026-10-05", status: "scheduled", costMinor: null, odometerThresholdKm: null, createdBy: ACTOR });
  });
});

afterAll(async () => {
  await asTenant(async (tx) => {
    await tx.delete(fleetDeviceTelemetry).where(eq(fleetDeviceTelemetry.tenantId, TENANT));
    await tx.delete(fleetMaintenance).where(eq(fleetMaintenance.tenantId, TENANT));
    await tx.delete(fleetDevices).where(eq(fleetDevices.tenantId, TENANT));
    await tx.delete(fleetVehicles).where(eq(fleetVehicles.tenantId, TENANT));
  });
  await app.close();
  await sqlClient.end();
});

describe("unique plate index (GAP-ASSETS-FLEET-VEHICLES-05)", () => {
  it("rejects a concurrent duplicate insert that the route pre-check cannot see", async () => {
    const results = await Promise.allSettled([
      asTenant((tx) => repo.insertVehicle(tx, vehicle(randomUUID(), "MH12AB2222"))),
      asTenant((tx) => repo.insertVehicle(tx, vehicle(randomUUID(), "mh-12 ab 2222"))),
    ]);
    expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(1);
    const rejected = results.find((r) => r.status === "rejected") as PromiseRejectedResult;
    const e = rejected.reason as { code?: string; cause?: { code?: string } };
    expect(e.code ?? e.cause?.code).toBe("23505");
  });

  it("allows the plate again once the first vehicle is decommissioned", async () => {
    const id = randomUUID();
    await asTenant((tx) => repo.insertVehicle(tx, vehicle(id, "GJ05AB3333")));
    await asTenant((tx) => repo.updateVehicleFields(tx, id, TENANT, { status: "decommissioned" }));
    await expect(asTenant((tx) => repo.insertVehicle(tx, vehicle(randomUUID(), "GJ05 AB 3333")))).resolves.toBeUndefined();
  });

  it("consumer turns a lost create race into a clean refusal (one row, audited failure, no throw)", async () => {
    const [a, b] = [randomUUID(), randomUUID()];
    const payload = (id: string, reg: string) => ({ id, tenantId: TENANT, registrationNo: reg, make: "Tata", model: "Nexon", year: 2023, fuelType: "cng" });
    await Promise.all([run(COMMANDS.fleetCreate, payload(a, "TN09AB4444")), run(COMMANDS.fleetCreate, payload(b, "TN-09-AB-4444"))]);
    const rows = await asTenant((tx) => tx.select().from(fleetVehicles).where(eq(fleetVehicles.tenantId, TENANT)));
    expect(rows.filter((r) => r.registrationNo.replace(/-/g, "") === "TN09AB4444")).toHaveLength(1);
    const audits = [...(await auditsFor(a)), ...(await auditsFor(b))];
    expect(audits.some((x) => x.payload.outcome === "failure" && x.payload.reason === "DUPLICATE_REGISTRATION")).toBe(true);
  });

  it("PATCH vehicle rejects a plate already used by another live vehicle, but not its own", async () => {
    const other = randomUUID();
    await asTenant((tx) => repo.insertVehicle(tx, vehicle(other, "RJ14AB5555")));
    const dup = await app.inject({ method: "PATCH", url: `/v1/assets/fleet/vehicles/${other}`, headers: { authorization: `Bearer ${admin()}` }, payload: { registrationNo: "ka 01-ab 1111" } });
    expect(dup.statusCode).toBe(409);
    expect(dup.json().code).toBe("DUPLICATE_REGISTRATION");
    const own = await app.inject({ method: "PATCH", url: `/v1/assets/fleet/vehicles/${other}`, headers: { authorization: `Bearer ${admin()}` }, payload: { registrationNo: "RJ-14-AB-5555" } });
    expect(own.statusCode).toBe(202);
  });

  it("PATCH consumer maps a unique violation to a clean refusal and leaves the row unchanged", async () => {
    const other = randomUUID();
    await asTenant((tx) => repo.insertVehicle(tx, vehicle(other, "PB10AB6666")));
    await run(COMMANDS.fleetVehicleUpdate, { id: other, tenantId: TENANT, registrationNo: "KA01AB1111" });
    const row = (await asTenant((tx) => tx.select().from(fleetVehicles).where(eq(fleetVehicles.id, other))))[0];
    expect(row?.registrationNo).toBe("PB10AB6666");
    expect((await auditsFor(other)).some((x) => x.payload.reason === "DUPLICATE_REGISTRATION")).toBe(true);
  });
});

describe("telemetry ordering + audit", () => {
  const tele = (timestamp: string, lat: number) => ({ deviceId, tenantId: TENANT, lat, lng: 77, speed: 10, heading: 90, timestamp });
  const vehicleRow = async () => (await asTenant((tx) => tx.select().from(fleetVehicles).where(eq(fleetVehicles.id, vehicleId))))[0]!;

  it("applies a newer reading, keeps a back-dated one only in history, and audits backdated", async () => {
    const t1 = new Date(Date.now() - 600_000).toISOString();
    const t0 = new Date(Date.now() - 3_600_000).toISOString();
    await run(COMMANDS.fleetDeviceTelemetry, tele(t1, 10));
    expect(Number((await vehicleRow()).currentLat)).toBeCloseTo(10, 3);

    await run(COMMANDS.fleetDeviceTelemetry, tele(t0, 20));
    const v = await vehicleRow();
    expect(Number(v.currentLat)).toBeCloseTo(10, 3); // not moved backwards
    expect(v.lastGpsAt?.toISOString()).toBe(t1);
    const history = await asTenant((tx) => tx.select().from(fleetDeviceTelemetry).where(eq(fleetDeviceTelemetry.deviceId, deviceId)));
    expect(history).toHaveLength(2); // history row still inserted

    const audits = (await auditsFor(deviceId)).map((a) => a.payload);
    const old = audits.find((a) => a.recordedAt === t0)!;
    const fresh = audits.find((a) => a.recordedAt === t1)!;
    expect(old).toMatchObject({ backdated: true, lat: 20, lng: 77 });
    expect(fresh).toMatchObject({ backdated: false, lat: 10 });
  });

  it("applies the first reading on a vehicle with no last_gps_at", async () => {
    const v2 = randomUUID();
    const d2 = randomUUID();
    await asTenant(async (tx) => {
      await repo.insertVehicle(tx, vehicle(v2, "UP32AB7777"));
      await repo.insertDevice(tx, { id: d2, tenantId: TENANT, vehicleId: v2, deviceImei: "356938035643809", protocol: "gt06", simIccid: null, status: "active", createdBy: ACTOR });
    });
    await run(COMMANDS.fleetDeviceTelemetry, { ...tele(new Date(Date.now() - 86_400_000).toISOString(), 33), deviceId: d2 });
    const row = (await asTenant((tx) => tx.select().from(fleetVehicles).where(eq(fleetVehicles.id, v2))))[0]!;
    expect(Number(row.currentLat)).toBeCloseTo(33, 3);
  });

  it("route: telemetry for an unknown device is 404, a known one 202", async () => {
    const body = { lat: 28.6, lng: 77.2, speed: 1, heading: 1, timestamp: new Date().toISOString() };
    const miss = await app.inject({ method: "POST", url: `/v1/assets/fleet/devices/${randomUUID()}/telemetry`, headers: { authorization: `Bearer ${admin()}` }, payload: body });
    expect(miss.statusCode).toBe(404);
    const hit = await app.inject({ method: "POST", url: `/v1/assets/fleet/devices/${deviceId}/telemetry`, headers: { authorization: `Bearer ${admin()}` }, payload: body });
    expect(hit.statusCode).toBe(202);
  });
});

describe("complete consumer is conditional (complete/cancel race)", () => {
  it("completes a scheduled job once and audits once; a replayed complete changes nothing", async () => {
    await run(COMMANDS.fleetMaintenanceComplete, { id: jobA, tenantId: TENANT, costMinor: 12500 });
    const row = await runWithTenant(TENANT, () => repo.findMaintenanceById(jobA, TENANT));
    expect(row?.status).toBe("completed");
    expect(row?.costMinor).toBe(12500n);
    await run(COMMANDS.fleetMaintenanceComplete, { id: jobA, tenantId: TENANT, costMinor: 99999 });
    const again = await runWithTenant(TENANT, () => repo.findMaintenanceById(jobA, TENANT));
    expect(again?.costMinor).toBe(12500n);
    expect((await auditsFor(jobA)).filter((a) => a.payload.action === "complete")).toHaveLength(1);
  });

  it("a complete that loses to a cancel does not overwrite it and writes no audit", async () => {
    const job = randomUUID();
    await asTenant((tx) => repo.insertMaintenance(tx, { id: job, tenantId: TENANT, vehicleId, type: "full_service", scheduledDate: "2026-10-06", status: "cancelled", costMinor: null, odometerThresholdKm: null, createdBy: ACTOR }));
    await run(COMMANDS.fleetMaintenanceComplete, { id: job, tenantId: TENANT, costMinor: 500 });
    const row = await runWithTenant(TENANT, () => repo.findMaintenanceById(job, TENANT));
    expect(row?.status).toBe("cancelled");
    expect(row?.costMinor).toBeNull();
    expect(await auditsFor(job)).toHaveLength(0);
  });
});
