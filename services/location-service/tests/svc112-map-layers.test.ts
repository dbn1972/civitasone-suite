/**
 * SVC-112 — Map-layers configuration API: CQRS command round-trip, RBAC, and
 * cross-tenant RLS isolation.
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { randomUUID } from "node:crypto";
import { signToken } from "@civitasone/auth";
import type { MemoryQueue } from "@civitasone/queue";
import { buildApp } from "../src/app.js";
import { queue } from "../src/shared/infra.js";
import { sqlClient } from "../src/shared/db.js";
import { registerMapLayerConsumers } from "../src/modules/map-layers/consumer.js";
import type { FastifyInstance } from "fastify";

const SECRET = process.env.JWT_SECRET ?? "test_secret_for_civitasone_32chr";
const TENANT_A = randomUUID();
const TENANT_B = randomUUID();
const ACTOR = randomUUID();
const admin = (tid: string) => signToken({ sub: ACTOR, tid, roles: ["location_admin", "gis_admin"], sid: "s" }, SECRET, 3600);
const reader = (tid: string) => signToken({ sub: ACTOR, tid, roles: ["location_user"], sid: "s" }, SECRET, 3600);

let app: FastifyInstance;
const drain = () => (queue as unknown as MemoryQueue).drain();

beforeAll(async () => {
  registerMapLayerConsumers(queue);
  app = await buildApp();
});
afterAll(async () => { await app.close(); await sqlClient.end(); });

const req = (method: string, url: string, token: string, payload?: unknown) =>
  app.inject({ method: method as "GET", url, headers: { authorization: `Bearer ${token}`, "content-type": "application/json" }, ...(payload !== undefined ? { payload } : {}) });

describe("SVC-112 map-layers CRUD", () => {
  let id = "";
  const name = `basemap-${Date.now()}`;

  it("creates a layer (202 accepted, persisted after drain)", async () => {
    const res = await req("POST", "/v1/locations/map-layers", admin(TENANT_A), {
      name, sourceType: "tile", url: "https://tiles.example.gov.in/{z}/{x}/{y}.png", zIndex: 1, visible: true,
      styleJson: { opacity: 0.8 },
    });
    expect(res.statusCode).toBe(202);
    expect(res.json().status).toBe("accepted");
    id = res.json().id;
    await drain();
    const list = await req("GET", "/v1/locations/map-layers", reader(TENANT_A));
    const layer = list.json().data.find((l: { id: string }) => l.id === id);
    expect(layer).toBeTruthy();
    expect(layer.sourceType).toBe("tile");
  });

  it("lists layers ordered by zIndex", async () => {
    await req("POST", "/v1/locations/map-layers", admin(TENANT_A), { name: `overlay-${Date.now()}`, sourceType: "wms", url: "https://wms.example.gov.in", zIndex: 0 });
    await drain();
    const res = await req("GET", "/v1/locations/map-layers", reader(TENANT_A));
    expect(res.statusCode).toBe(200);
    const layers = res.json().data;
    expect(layers.length).toBeGreaterThanOrEqual(2);
    expect(layers[0].zIndex).toBeLessThanOrEqual(layers[1].zIndex);
  });

  it("patches a layer (202 accepted, visibility + version bump after drain)", async () => {
    const res = await req("PATCH", `/v1/locations/map-layers/${id}`, admin(TENANT_A), { visible: false, zIndex: 5 });
    expect(res.statusCode).toBe(202);
    expect(res.json().status).toBe("accepted");
    await drain();
    const list = await req("GET", "/v1/locations/map-layers", reader(TENANT_A));
    const layer = list.json().data.find((l: { id: string }) => l.id === id);
    expect(layer.visible).toBe(false);
    expect(layer.zIndex).toBe(5);
    expect(layer.version).toBe(2);
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

  it("deletes a layer (202 accepted, gone after drain)", async () => {
    const res = await req("DELETE", `/v1/locations/map-layers/${id}`, admin(TENANT_A));
    expect(res.statusCode).toBe(202);
    expect(res.json().status).toBe("accepted");
    await drain();
    const patch = await req("PATCH", `/v1/locations/map-layers/${id}`, admin(TENANT_A), { visible: true });
    expect(patch.statusCode).toBe(404);
  });
});
