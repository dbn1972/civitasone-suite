/**
 * SVC-114 — Geospatial asset registry: real round-trip persistence and
 * cross-tenant RLS isolation for location.infrastructure_assets.
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { randomUUID } from "node:crypto";
import { signToken } from "@civitasone/auth";
import type { MemoryQueue } from "@civitasone/queue";
import { buildApp } from "../src/app.js";
import { queue } from "../src/shared/infra.js";
import { sqlClient } from "../src/shared/db.js";
import { registerInfrastructureConsumers } from "../src/modules/infrastructure/consumer.js";
import type { FastifyInstance } from "fastify";

const SECRET = process.env.JWT_SECRET ?? "test_secret_for_civitasone_32chr";
const TENANT_A = randomUUID();
const TENANT_B = randomUUID();
const ACTOR = randomUUID();
const tok = (tid: string) => signToken({ sub: ACTOR, tid, roles: ["location_admin", "asset_admin"], sid: "s" }, SECRET, 3600);

let app: FastifyInstance;
const drain = () => (queue as unknown as MemoryQueue).drain();

beforeAll(async () => { registerInfrastructureConsumers(queue); app = await buildApp(); });
afterAll(async () => { await app.close(); await sqlClient.end(); });

const post = (url: string, tid: string, payload: unknown) =>
  app.inject({ method: "POST", url, headers: { authorization: `Bearer ${tok(tid)}`, "content-type": "application/json" }, payload });
const get = (url: string, tid: string) => app.inject({ method: "GET", url, headers: { authorization: `Bearer ${tok(tid)}` } });

describe("SVC-114 infrastructure round-trip", () => {
  const name = `Bridge-${Date.now()}`;
  let id = "";

  it("persists an asset and reads it back", async () => {
    const res = await post("/v1/locations/infrastructure", TENANT_A, { name, type: "bridge", lat: 28.61, lng: 77.21, conditionScore: 4 });
    expect(res.statusCode).toBe(202);
    id = res.json().data.id;
    await drain();
    const list = await get("/v1/locations/infrastructure", TENANT_A);
    expect(list.statusCode).toBe(200);
    const a = list.json().data.find((r: { name: string }) => r.name === name);
    expect(a).toBeTruthy();
    expect(a.type).toBe("bridge");
    expect(a.lat).toBeCloseTo(28.61, 4);
    expect(a.conditionScore).toBe(4);
  });

  it("reads a single asset by id", async () => {
    const one = await get(`/v1/locations/infrastructure/${id}`, TENANT_A);
    expect(one.statusCode).toBe(200);
    expect(one.json().data.name).toBe(name);
  });

  it("isolates assets across tenants (RLS)", async () => {
    const listB = await get("/v1/locations/infrastructure", TENANT_B);
    expect(listB.statusCode).toBe(200);
    expect(listB.json().data.filter((r: { name: string }) => r.name === name)).toHaveLength(0);
    const oneB = await get(`/v1/locations/infrastructure/${id}`, TENANT_B);
    expect(oneB.statusCode).toBe(404);
  });
});
