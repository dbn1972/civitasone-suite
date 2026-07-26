/**
 * SVC-119 — Map-markers monitoring feed: aggregates infrastructure assets,
 * cadastral parcels, and registered geo-points; supports domain/status/bbox
 * filters; the geo_points registry is an idempotent tenant-scoped extension
 * point (HTTP + queue). Cross-tenant RLS isolation verified.
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { randomUUID } from "node:crypto";
import { signToken } from "@civitasone/auth";
import type { MemoryQueue } from "@civitasone/queue";
import { isPostGISAvailable } from "./setup.js";

const HAS_POSTGIS = await isPostGISAvailable();
const describePostGIS = HAS_POSTGIS ? describe : describe.skip;
import { buildApp } from "../src/app.js";
import { queue } from "../src/shared/infra.js";
import { sqlClient } from "../src/shared/db.js";
import { registerInfrastructureConsumers } from "../src/modules/infrastructure/consumer.js";
import { registerGeoPointConsumers, GEO_POINT_REGISTER } from "../src/modules/map-markers/consumer.js";
import type { FastifyInstance } from "fastify";

const SECRET = process.env.JWT_SECRET ?? "test_secret_for_civitasone_32chr";
const TENANT_A = randomUUID();
const TENANT_B = randomUUID();
const ACTOR = randomUUID();
const tok = (tid: string) => signToken({ sub: ACTOR, tid, roles: ["location_admin", "gis_admin", "asset_admin"], sid: "s" }, SECRET, 3600);

let app: FastifyInstance;
const drain = () => (queue as unknown as MemoryQueue).drain();
const post = (url: string, tid: string, payload: unknown) =>
  app.inject({ method: "POST", url, headers: { authorization: `Bearer ${tok(tid)}`, "content-type": "application/json" }, payload });
const get = (url: string, tid: string) => app.inject({ method: "GET", url, headers: { authorization: `Bearer ${tok(tid)}` } });

const infraName = `tower-${Date.now()}`;

beforeAll(async () => {
  registerInfrastructureConsumers(queue);
  registerGeoPointConsumers(queue);
  app = await buildApp();
  // an infrastructure asset near Delhi
  await post("/v1/locations/infrastructure", TENANT_A, { name: infraName, type: "telecom_tower", lat: 28.60, lng: 77.20 });
  await drain();
});
afterAll(async () => { await app.close(); await sqlClient.end(); });

describePostGIS("SVC-119 geo-points registry + markers feed", () => {
  const refId = `sensor-${Date.now()}`;

  it("registers a geo-point (HTTP) and it appears in the feed", async () => {
    const res = await post("/v1/locations/geo-points", TENANT_A, { domain: "sensor", refId, lat: 28.61, lng: 77.21, label: "AQ sensor", status: "alert" });
    expect(res.statusCode).toBe(201);
    await drain();
    const feed = await get("/v1/locations/map-markers", TENANT_A);
    expect(feed.statusCode).toBe(200);
    const markers = feed.json().markers as Array<{ domain: string; refId: string; label: string; status: string; lat: number; lng: number }>;
    const m = markers.find((x) => x.refId === refId);
    expect(m).toBeTruthy();
    expect(m!.domain).toBe("sensor");
    expect(m!.status).toBe("alert");
    expect(m!.lat).toBeCloseTo(28.61, 4);
    // the infrastructure asset is aggregated too
    expect(markers.some((x) => x.domain === "infrastructure" && x.label === infraName)).toBe(true);
  });

  it("upsert is idempotent (queue re-register updates, not duplicates)", async () => {
    await queue.publish(GEO_POINT_REGISTER, {
      messageId: randomUUID(), type: GEO_POINT_REGISTER, tenantId: TENANT_A, actorId: ACTOR,
      correlationId: "c", schemaVersion: "1.0", payload: { domain: "sensor", refId, lat: 28.62, lng: 77.22, label: "AQ sensor v2", status: "ok" },
    });
    await drain();
    const feed = await get("/v1/locations/map-markers?domain=sensor", TENANT_A);
    const rows = feed.json().markers.filter((x: { refId: string }) => x.refId === refId);
    expect(rows).toHaveLength(1);
    expect(rows[0].status).toBe("ok");
    expect(rows[0].lat).toBeCloseTo(28.62, 4);
  });

  it("filters by domain and bbox", async () => {
    const infraOnly = await get("/v1/locations/map-markers?domain=infrastructure", TENANT_A);
    expect(infraOnly.json().markers.every((x: { domain: string }) => x.domain === "infrastructure")).toBe(true);
    // bbox around Mumbai excludes the Delhi markers
    const mumbai = await get("/v1/locations/map-markers?bbox=72.7,18.9,73.0,19.3", TENANT_A);
    expect(mumbai.json().markers).toHaveLength(0);
  });

  it("isolates the feed across tenants (RLS)", async () => {
    const feedB = await get("/v1/locations/map-markers", TENANT_B);
    expect(feedB.statusCode).toBe(200);
    expect(feedB.json().markers.filter((x: { refId: string }) => x.refId === refId)).toHaveLength(0);
    expect(feedB.json().markers.some((x: { label: string }) => x.label === infraName)).toBe(false);
  });
});
