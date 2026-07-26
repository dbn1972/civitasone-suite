/**
 * SVC-115 — Road/route network: persisted PostGIS LineString segments,
 * route networks, basic connectivity, and cross-tenant RLS isolation.
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { randomUUID } from "node:crypto";
import { signToken } from "@civitasone/auth";
import { buildApp } from "../src/app.js";
import { sqlClient } from "../src/shared/db.js";
import type { FastifyInstance } from "fastify";

const SECRET = process.env.JWT_SECRET ?? "test_secret_for_civitasone_32chr";
const TENANT_A = randomUUID();
const TENANT_B = randomUUID();
const ACTOR = randomUUID();
const tok = (tid: string) => signToken({ sub: ACTOR, tid, roles: ["location_admin", "works_admin"], sid: "s" }, SECRET, 3600);

let app: FastifyInstance;
beforeAll(async () => { app = await buildApp(); });
afterAll(async () => { await app.close(); await sqlClient.end(); });

const post = (url: string, tid: string, payload: unknown) =>
  app.inject({ method: "POST", url, headers: { authorization: `Bearer ${tok(tid)}`, "content-type": "application/json" }, payload });
const get = (url: string, tid: string) => app.inject({ method: "GET", url, headers: { authorization: `Bearer ${tok(tid)}` } });
const del = (url: string, tid: string) => app.inject({ method: "DELETE", url, headers: { authorization: `Bearer ${tok(tid)}` } });

describe("SVC-115 road segments", () => {
  const N = randomUUID().slice(0, 8);
  let seg1 = "", seg2 = "", seg3 = "";

  it("creates segments with derived geometry + length", async () => {
    const r1 = await post("/v1/locations/road-network/segments", TENANT_A, {
      name: `NH-${N}-1`, roadClass: "national_highway", fromNode: `${N}-A`, toNode: `${N}-B`,
      coordinates: [[77.0, 28.0], [77.1, 28.0]],
    });
    expect(r1.statusCode).toBe(201); seg1 = r1.json().data.id;
    const r2 = await post("/v1/locations/road-network/segments", TENANT_A, {
      name: `SH-${N}-2`, roadClass: "state_highway", fromNode: `${N}-B`, toNode: `${N}-C`,
      coordinates: [[77.1, 28.0], [77.2, 28.05]],
    });
    expect(r2.statusCode).toBe(201); seg2 = r2.json().data.id;
    const r3 = await post("/v1/locations/road-network/segments", TENANT_A, {
      name: `VR-${N}-3`, roadClass: "village_road", fromNode: `${N}-X`, toNode: `${N}-Y`,
      coordinates: [[78.0, 29.0], [78.1, 29.0]],
    });
    expect(r3.statusCode).toBe(201); seg3 = r3.json().data.id;

    const one = await get(`/v1/locations/road-network/segments/${seg1}`, TENANT_A);
    expect(one.statusCode).toBe(200);
    expect(one.json().data.lengthMeters).toBeGreaterThan(9000); // ~9.8km at this latitude
    expect(one.json().data.coordinates).toHaveLength(2);
    expect(one.json().data.coordinates[0][0]).toBeCloseTo(77.0, 4);
  });

  it("computes basic connectivity (shared node)", async () => {
    const res = await get(`/v1/locations/road-network/segments/${seg1}/connected`, TENANT_A);
    expect(res.statusCode).toBe(200);
    const ids = res.json().data.map((s: { id: string }) => s.id);
    expect(ids).toContain(seg2);   // shares node B
    expect(ids).not.toContain(seg3); // disconnected
  });

  it("creates a route network referencing segments", async () => {
    const res = await post("/v1/locations/road-network/networks", TENANT_A, {
      name: `corridor-${N}`, description: "test corridor", segmentIds: [seg1, seg2],
    });
    expect(res.statusCode).toBe(201);
    const list = await get("/v1/locations/road-network/networks", TENANT_A);
    const net = list.json().data.find((n: { name: string }) => n.name === `corridor-${N}`);
    expect(net.segmentIds).toEqual([seg1, seg2]);
  });

  it("isolates segments across tenants (RLS)", async () => {
    const listB = await get("/v1/locations/road-network/segments", TENANT_B);
    expect(listB.statusCode).toBe(200);
    expect(listB.json().data.map((s: { id: string }) => s.id)).not.toContain(seg1);
    const oneB = await get(`/v1/locations/road-network/segments/${seg1}`, TENANT_B);
    expect(oneB.statusCode).toBe(404);
  });

  it("deletes a segment", async () => {
    const res = await del(`/v1/locations/road-network/segments/${seg3}`, TENANT_A);
    expect(res.statusCode).toBe(200);
    const gone = await get(`/v1/locations/road-network/segments/${seg3}`, TENANT_A);
    expect(gone.statusCode).toBe(404);
  });
});
