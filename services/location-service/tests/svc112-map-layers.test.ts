/**
 * SVC-112 — Map-layers configuration API: CRUD round-trip, RBAC, and
 * cross-tenant RLS isolation.
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
const admin = (tid: string) => signToken({ sub: ACTOR, tid, roles: ["location_admin", "gis_admin"], sid: "s" }, SECRET, 3600);
const reader = (tid: string) => signToken({ sub: ACTOR, tid, roles: ["location_user"], sid: "s" }, SECRET, 3600);

let app: FastifyInstance;
beforeAll(async () => { app = await buildApp(); });
afterAll(async () => { await app.close(); await sqlClient.end(); });

const req = (method: string, url: string, token: string, payload?: unknown) =>
  app.inject({ method: method as "GET", url, headers: { authorization: `Bearer ${token}`, "content-type": "application/json" }, ...(payload !== undefined ? { payload } : {}) });

describe("SVC-112 map-layers CRUD", () => {
  let id = "";
  const name = `basemap-${Date.now()}`;

  it("creates a layer", async () => {
    const res = await req("POST", "/v1/locations/map-layers", admin(TENANT_A), {
      name, sourceType: "tile", url: "https://tiles.example.gov.in/{z}/{x}/{y}.png", zIndex: 1, visible: true,
      styleJson: { opacity: 0.8 },
    });
    expect(res.statusCode).toBe(201);
    id = res.json().data.id;
    expect(res.json().data.sourceType).toBe("tile");
  });

  it("lists layers ordered by zIndex", async () => {
    await req("POST", "/v1/locations/map-layers", admin(TENANT_A), { name: `overlay-${Date.now()}`, sourceType: "wms", url: "https://wms.example.gov.in", zIndex: 0 });
    const res = await req("GET", "/v1/locations/map-layers", reader(TENANT_A));
    expect(res.statusCode).toBe(200);
    const layers = res.json().data;
    expect(layers.length).toBeGreaterThanOrEqual(2);
    expect(layers[0].zIndex).toBeLessThanOrEqual(layers[1].zIndex);
  });

  it("patches a layer (visibility + version bump)", async () => {
    const res = await req("PATCH", `/v1/locations/map-layers/${id}`, admin(TENANT_A), { visible: false, zIndex: 5 });
    expect(res.statusCode).toBe(200);
    expect(res.json().data.visible).toBe(false);
    expect(res.json().data.zIndex).toBe(5);
    expect(res.json().data.version).toBe(2);
  });

  it("forbids readers from creating layers (RBAC)", async () => {
    const res = await req("POST", "/v1/locations/map-layers", reader(TENANT_A), { name: "x", sourceType: "tile", url: "https://x.example.gov.in" });
    expect(res.statusCode).toBe(403);
  });

  it("isolates layers across tenants (RLS)", async () => {
    const listB = await req("GET", "/v1/locations/map-layers", admin(TENANT_B));
    expect(listB.json().data.map((l: { id: string }) => l.id)).not.toContain(id);
    const patchB = await req("PATCH", `/v1/locations/map-layers/${id}`, admin(TENANT_B), { visible: true });
    expect(patchB.statusCode).toBe(404);
  });

  it("deletes a layer", async () => {
    const res = await req("DELETE", `/v1/locations/map-layers/${id}`, admin(TENANT_A));
    expect(res.statusCode).toBe(200);
    const patch = await req("PATCH", `/v1/locations/map-layers/${id}`, admin(TENANT_A), { visible: true });
    expect(patch.statusCode).toBe(404);
  });
});
