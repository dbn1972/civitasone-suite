/**
 * UAT-P2-D1 (/locations/maps/monitoring): end-to-end over the real test DB.
 * Runs with or without PostGIS: on a cluster without it (as UAT is today)
 * the PostGIS-backed sources are absent and the feed must still answer 200
 * with the infrastructure assets it does have, never a 500.
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { randomUUID } from "node:crypto";
import { signToken } from "@civitasone/auth";
import type { MemoryQueue } from "@civitasone/queue";
import type { FastifyInstance } from "fastify";
import { buildApp } from "../src/app.js";
import { queue } from "../src/shared/infra.js";
import { sqlClient } from "../src/shared/db.js";
import { registerInfrastructureConsumers } from "../src/modules/infrastructure/consumer.js";

const SECRET = process.env.JWT_SECRET ?? "test_secret_for_civitasone_32chr";
const TENANT = randomUUID();
const ACTOR = randomUUID();
const tok = signToken({ sub: ACTOR, tid: TENANT, roles: ["location_admin", "gis_admin", "asset_admin"], sid: "s" }, SECRET, 3600);
const name = `uat-p2-d1-tower-${Date.now()}`;
let app: FastifyInstance;

beforeAll(async () => {
  registerInfrastructureConsumers(queue);
  app = await buildApp();
  await app.inject({
    method: "POST",
    url: "/v1/locations/infrastructure",
    headers: { authorization: `Bearer ${tok}`, "content-type": "application/json" },
    payload: { name, type: "telecom_tower", lat: 28.6, lng: 77.2 },
  });
  await (queue as unknown as MemoryQueue).drain();
});
afterAll(async () => {
  await app.close();
  await sqlClient.end();
});

describe("GET /v1/locations/map-markers degrades instead of 500 (UAT-P2-D1)", () => {
  it("answers 200 and lists the tenant's infrastructure asset", async () => {
    const res = await app.inject({ method: "GET", url: "/v1/locations/map-markers", headers: { authorization: `Bearer ${tok}` } });
    expect(res.statusCode).toBe(200);
    const body = res.json() as { markers: Array<{ domain: string; label: string }>; meta: { total: number } };
    expect(body.markers.some((m) => m.domain === "infrastructure" && m.label === name)).toBe(true);
    expect(body.meta.total).toBe(body.markers.length);
  });
});
