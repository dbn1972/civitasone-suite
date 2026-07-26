/**
 * SVC-118 — Spatial queries with real PostGIS. Seeds geolocated locations,
 * then asserts within-radius / within-polygon / clusters return the correct set
 * (positive results, not just validation), tenant-scoped by RLS.
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { randomUUID } from "node:crypto";
import { signToken } from "@civitasone/auth";
import type { MemoryQueue } from "@civitasone/queue";
import { buildApp } from "../src/app.js";
import { isPostGISAvailable } from "./setup.js";

const HAS_POSTGIS = await isPostGISAvailable();
const describePostGIS = HAS_POSTGIS ? describe : describe.skip;
import { queue } from "../src/shared/infra.js";
import { sqlClient } from "../src/shared/db.js";
import { registerLocationConsumers } from "../src/modules/locations/consumer.js";
import type { FastifyInstance } from "fastify";

const SECRET = process.env.JWT_SECRET ?? "test_secret_for_civitasone_32chr";
const TENANT_A = randomUUID();
const TENANT_B = randomUUID();
const ACTOR = randomUUID();
const tok = (tid: string) => signToken({ sub: ACTOR, tid, roles: ["location_admin", "super_admin"], sid: "s" }, SECRET, 3600);

let app: FastifyInstance;
const drain = () => (queue as unknown as MemoryQueue).drain();
const post = (url: string, tid: string, payload: unknown) =>
  app.inject({ method: "POST", url, headers: { authorization: `Bearer ${tok(tid)}`, "content-type": "application/json" }, payload });
const get = (url: string, tid: string) => app.inject({ method: "GET", url, headers: { authorization: `Bearer ${tok(tid)}` } });

// Three clustered near Delhi (28.6,77.2), one far away in Mumbai (19.07,72.87).
const NEAR = [
  { name: "delhi-a", lat: 28.60, lng: 77.20 },
  { name: "delhi-b", lat: 28.61, lng: 77.21 },
  { name: "delhi-c", lat: 28.62, lng: 77.19 },
];
const FAR = { name: "mumbai", lat: 19.07, lng: 72.87 };

beforeAll(async () => {
  registerLocationConsumers(queue);
  app = await buildApp();
  for (const p of [...NEAR, FAR]) {
    await post("/v1/locations", TENANT_A, { name: `${p.name}-${TENANT_A.slice(0, 8)}`, type: "office", latitude: p.lat, longitude: p.lng });
  }
  // one far point for tenant B (must never leak into tenant A results)
  await post("/v1/locations", TENANT_B, { name: "b-delhi", type: "office", latitude: 28.605, longitude: 77.205 });
  await drain();
});
afterAll(async () => { await app.close(); await sqlClient.end(); });

describePostGIS("SVC-118 within-radius", () => {
  it("returns only points inside the radius", async () => {
    const res = await post("/v1/locations/spatial/within-radius", TENANT_A, { lat: 28.61, lng: 77.20, radiusKm: 10 });
    expect(res.statusCode).toBe(200);
    const names = res.json().data.map((r: { name: string }) => r.name);
    expect(names.filter((n: string) => n.startsWith("delhi")).length).toBe(3);
    expect(names.some((n: string) => n.startsWith("mumbai"))).toBe(false);
    // distanceKm is populated and ordered ascending
    const dists = res.json().data.map((r: { distanceKm: number }) => r.distanceKm);
    expect(dists[0]).toBeLessThanOrEqual(dists[dists.length - 1]);
  });

  it("isolates results by tenant (RLS)", async () => {
    const res = await post("/v1/locations/spatial/within-radius", TENANT_A, { lat: 28.605, lng: 77.205, radiusKm: 5 });
    const names = res.json().data.map((r: { name: string }) => r.name);
    expect(names).not.toContain("b-delhi");
  });
});

describePostGIS("SVC-118 within-polygon", () => {
  it("returns points inside the polygon only", async () => {
    // tight box around Delhi cluster
    const res = await post("/v1/locations/spatial/within-polygon", TENANT_A, {
      polygon: [{ lat: 28.55, lng: 77.15 }, { lat: 28.55, lng: 77.25 }, { lat: 28.65, lng: 77.25 }, { lat: 28.65, lng: 77.15 }],
    });
    expect(res.statusCode).toBe(200);
    const names = res.json().data.map((r: { name: string }) => r.name);
    expect(names.filter((n: string) => n.startsWith("delhi")).length).toBe(3);
    expect(names.some((n: string) => n.startsWith("mumbai"))).toBe(false);
  });
});

describePostGIS("SVC-118 clusters", () => {
  it("returns k-means clusters with counts summing to the tenant's geolocated points", async () => {
    const res = await get("/v1/locations/spatial/clusters?k=2", TENANT_A);
    expect(res.statusCode).toBe(200);
    const clusters = res.json().data as Array<{ count: number; centroidLat: number; centroidLng: number }>;
    expect(clusters.length).toBeGreaterThanOrEqual(1);
    const total = clusters.reduce((s, c) => s + c.count, 0);
    expect(total).toBe(4); // 3 delhi + 1 mumbai for tenant A
    for (const c of clusters) { expect(Number.isFinite(c.centroidLat)).toBe(true); expect(Number.isFinite(c.centroidLng)).toBe(true); }
  });
});
