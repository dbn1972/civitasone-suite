/**
 * GET /v1/assets/fleet/maintenance with a costed job (PR #1845 review D1):
 * cost_minor is a bigint column, which JSON.stringify cannot serialise. Real
 * Postgres and the real Fastify serialiser (incl. the shared jsonSafe
 * preSerialization hook), no mocks: the response must be 200 with costMinor as
 * an exact decimal string, even above 2^53.
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import { runWithTenant } from "@civitasone/db";
import { signToken } from "@civitasone/auth";
import { buildApp } from "../src/app.js";
import { db, sqlClient } from "../src/shared/db.js";
import { fleetMaintenance, fleetVehicles } from "../src/modules/fleet/schema.js";
import type { FastifyInstance } from "fastify";

const SECRET = process.env.JWT_SECRET ?? "test_secret_for_civitasone_32chr";
const TENANT = randomUUID();
const ACTOR = randomUUID();
const BIG = 9007199254740993n; // 2^53 + 1: would be corrupted by any Number() coercion
let app: FastifyInstance;
const token = () => signToken({ sub: ACTOR, tid: TENANT, roles: ["fleet_manager"], sid: "s-fleet-cost" }, SECRET, 3600);

type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0];
const asTenant = <T,>(fn: (tx: Tx) => Promise<T>): Promise<T> => runWithTenant(TENANT, () => db.transaction(fn)) as Promise<T>;

beforeAll(async () => {
  app = await buildApp();
  await app.ready();
  const v = randomUUID();
  await asTenant(async (tx) => {
    await tx.insert(fleetVehicles).values({ id: v, tenantId: TENANT, registrationNo: "KA01AB1234", createdBy: ACTOR });
    await tx.insert(fleetMaintenance).values([
      { tenantId: TENANT, vehicleId: v, type: "service", scheduledDate: "2026-05-01", status: "completed", costMinor: BIG },
      { tenantId: TENANT, vehicleId: v, type: "tyres", scheduledDate: "2026-06-01", status: "scheduled", costMinor: null },
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

describe("GET /v1/assets/fleet/maintenance", () => {
  it("returns 200 with costMinor as an exact decimal string (null when no cost)", async () => {
    const res = await app.inject({ method: "GET", url: "/v1/assets/fleet/maintenance", headers: { authorization: `Bearer ${token()}` } });
    expect(res.statusCode).toBe(200);
    const rows = res.json().data as Array<{ type: string; costMinor: string | null }>;
    expect(rows.find((r) => r.type === "service")?.costMinor).toBe("9007199254740993");
    expect(rows.find((r) => r.type === "tyres")?.costMinor).toBeNull();
  });
});
