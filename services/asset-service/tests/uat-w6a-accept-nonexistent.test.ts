/**
 * UAT W6-A (P1 accept-nonexistent): every command route below used to publish without
 * reading its target, so a random id got 202. Each now does a tenant-scoped existence
 * read first: random id -> 404 and nothing published; a real row -> 202 and the command
 * is published (the consumer stays the race-safe authority).
 */
import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";
import { randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import { runWithTenant } from "@civitasone/db";
import { signToken } from "@civitasone/auth";
import type { FastifyInstance } from "fastify";
import { buildApp } from "../src/app.js";
import { db, sqlClient } from "../src/shared/db.js";
import { queue } from "../src/shared/infra.js";
import { assetAssets, assetCategories } from "../src/modules/register/schema.js";
import { fleetVehicles } from "../src/modules/fleet/schema.js";
import { assetStreetlightRequests } from "../src/modules/streetlight/schema.js";
import { assetWaterApplications, assetWaterConnections } from "../src/modules/water-connections/schema.js";
import { assetWaterTankerBookings } from "../src/modules/water-tanker/schema.js";

const SECRET = process.env.JWT_SECRET as string;
const TENANT = "aaaaaaaa-6a6a-4000-8000-0000000006a1";
const OTHER_TENANT = "bbbbbbbb-6a6a-4000-8000-0000000006a2";
const ACTOR = "cccccccc-6a6a-4000-8000-0000000006a1";

type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0];
const asTenant = <T>(tenantId: string, fn: (tx: Tx) => Promise<T>): Promise<T> =>
  runWithTenant(tenantId, () => db.transaction(fn)) as Promise<T>;
const bearer = (tenantId = TENANT) => ({
  authorization: `Bearer ${signToken({ sub: ACTOR, tid: tenantId, roles: ["super_admin"] }, SECRET, 3600)}`,
});

let app: FastifyInstance;
const categoryId = randomUUID();
const tag = Date.now().toString(36);
const ids = {
  asset: randomUUID(), vehicle: randomUUID(), slRequest: randomUUID(),
  application: randomUUID(), connection: randomUUID(), booking: randomUUID(),
};

beforeAll(async () => {
  app = await buildApp();
  await app.ready();
  await asTenant(TENANT, async (tx) => {
    await tx.insert(assetCategories).values({ id: categoryId, tenantId: TENANT, code: `W6A-${tag}`, name: "w6a", createdBy: ACTOR, updatedBy: ACTOR });
    await tx.insert(assetAssets).values({
      id: ids.asset, tenantId: TENANT, name: "W6A asset", code: `W6A-${tag}`, categoryId, status: "active", assetType: "fixed",
      acquisitionCost: 100000n, bookValue: 100000n, accumulatedDep: 0n, acquisitionDate: "2026-01-01", createdBy: ACTOR, updatedBy: ACTOR,
    });
    await tx.insert(fleetVehicles).values({ id: ids.vehicle, tenantId: TENANT, registrationNo: `W6A${tag}`.slice(0, 20), createdBy: ACTOR });
    await tx.insert(assetStreetlightRequests).values({
      id: ids.slRequest, tenantId: TENANT, requestNumber: `W6A-SLR-${tag}`, requestedBy: ACTOR, requestType: "new_light", createdBy: ACTOR, updatedBy: ACTOR,
    });
    await tx.insert(assetWaterApplications).values({
      id: ids.application, tenantId: TENANT, applicationNumber: `W6A-WA-${tag}`, applicantName: "W6A", applicantPhone: "9000000000",
      connectionType: "domestic", createdBy: ACTOR, updatedBy: ACTOR,
    });
    await tx.insert(assetWaterConnections).values({
      id: ids.connection, tenantId: TENANT, connectionNumber: `W6A-WC-${tag}`, applicationId: ids.application, status: "installed",
      connectionType: "domestic", createdBy: ACTOR, updatedBy: ACTOR,
    });
    await tx.insert(assetWaterTankerBookings).values({
      id: ids.booking, tenantId: TENANT, bookingNumber: `W6A-TB-${tag}`, requestedBy: ACTOR, tankerCapacityLitres: 5000,
      requestedDate: "2026-11-01", createdBy: ACTOR, updatedBy: ACTOR,
    });
  });
});

afterAll(async () => {
  await asTenant(TENANT, async (tx) => {
    await tx.delete(assetWaterTankerBookings).where(eq(assetWaterTankerBookings.id, ids.booking));
    await tx.delete(assetWaterConnections).where(eq(assetWaterConnections.id, ids.connection));
    await tx.delete(assetWaterApplications).where(eq(assetWaterApplications.id, ids.application));
    await tx.delete(assetStreetlightRequests).where(eq(assetStreetlightRequests.id, ids.slRequest));
    await tx.delete(fleetVehicles).where(eq(fleetVehicles.id, ids.vehicle));
    await tx.delete(assetAssets).where(eq(assetAssets.id, ids.asset));
    await tx.delete(assetCategories).where(eq(assetCategories.id, categoryId));
  }).catch(() => undefined);
  await app.close();
  await sqlClient.end();
});

type Case = { name: string; method: "POST" | "PATCH"; url: (id: string) => string; realId: () => string; payload?: Record<string, unknown> };
const cases: Case[] = [
  { name: "asset maintenance plan", method: "POST", url: (id) => `/v1/assets/assets/${id}/maintenance`, realId: () => ids.asset, payload: { frequency: "quarterly", nextDue: "2026-12-01" } },
  { name: "asset writeoff request", method: "POST", url: (id) => `/v1/assets/assets/${id}/writeoff-request`, realId: () => ids.asset, payload: { remarks: "w6a" } },
  { name: "fleet vehicle update", method: "PATCH", url: (id) => `/v1/assets/fleet/vehicles/${id}`, realId: () => ids.vehicle, payload: { odometerKm: 10 } },
  { name: "streetlight request approve", method: "POST", url: (id) => `/v1/assets/streetlight-requests/${id}/approve`, realId: () => ids.slRequest },
  { name: "water application submit", method: "POST", url: (id) => `/v1/assets/water/applications/${id}/submit`, realId: () => ids.application },
  { name: "water application approve", method: "POST", url: (id) => `/v1/assets/water/applications/${id}/approve`, realId: () => ids.application },
  { name: "water application install", method: "POST", url: (id) => `/v1/assets/water/applications/${id}/install`, realId: () => ids.application, payload: {} },
  { name: "water connection activate", method: "POST", url: (id) => `/v1/assets/water/applications/${id}/activate`, realId: () => ids.connection },
  { name: "tanker booking dispatch", method: "POST", url: (id) => `/v1/assets/water/tanker-bookings/${id}/dispatch`, realId: () => ids.booking },
  { name: "tanker booking deliver", method: "POST", url: (id) => `/v1/assets/water/tanker-bookings/${id}/deliver`, realId: () => ids.booking },
  { name: "tanker booking cancel", method: "POST", url: (id) => `/v1/assets/water/tanker-bookings/${id}/cancel`, realId: () => ids.booking },
];

describe("UAT W6-A: asset command routes answer 404 for a record that does not exist", () => {
  for (const c of cases) {
    it(`${c.name}: random id -> 404, nothing published`, async () => {
      const spy = vi.spyOn(queue, "publish");
      try {
        const res = await app.inject({ method: c.method, url: c.url(randomUUID()), headers: bearer(), payload: c.payload ?? {} });
        expect(res.statusCode).toBe(404);
        expect(res.json().code).toBe("NOT_FOUND");
        expect(spy).not.toHaveBeenCalled();
      } finally {
        spy.mockRestore();
      }
    });

    it(`${c.name}: another tenant's real id -> 404 (tenant-scoped read), nothing published`, async () => {
      const spy = vi.spyOn(queue, "publish");
      try {
        const res = await app.inject({ method: c.method, url: c.url(c.realId()), headers: bearer(OTHER_TENANT), payload: c.payload ?? {} });
        expect(res.statusCode).toBe(404);
        expect(spy).not.toHaveBeenCalled();
      } finally {
        spy.mockRestore();
      }
    });

    it(`${c.name}: real id -> 202 and the command is published`, async () => {
      const spy = vi.spyOn(queue, "publish").mockResolvedValue(undefined as never);
      try {
        const res = await app.inject({ method: c.method, url: c.url(c.realId()), headers: bearer(), payload: c.payload ?? {} });
        expect(res.statusCode).toBe(202);
        expect(spy).toHaveBeenCalledTimes(1);
        expect(spy.mock.calls[0]![1]).toMatchObject({ tenantId: TENANT });
      } finally {
        spy.mockRestore();
      }
    });
  }
});
