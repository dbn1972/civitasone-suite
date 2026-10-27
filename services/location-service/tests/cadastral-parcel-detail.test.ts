/**
 * GAP-LOCATIONS-MAPS-MONITORING-01: GET /v1/locations/cadastral/parcels/:id, the target of the monitoring
 * map's "Open record" link for a parcel marker (marker refId = parcel id). Real DB, PostGIS-gated like the
 * rest of the cadastral suite.
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { randomUUID } from "node:crypto";
import { signToken } from "@civitasone/auth";
import type { MemoryQueue } from "@civitasone/queue";
import { isPostGISAvailable } from "./setup.js";
import { buildApp } from "../src/app.js";
import { queue } from "../src/shared/infra.js";
import { sqlClient } from "../src/shared/db.js";
import { registerCadastralConsumers } from "../src/modules/cadastral/consumer.js";
import type { FastifyInstance } from "fastify";

const HAS_POSTGIS = await isPostGISAvailable();
const describePostGIS = HAS_POSTGIS ? describe : describe.skip;

const SECRET = process.env.JWT_SECRET ?? "test_secret_for_civitasone_32chr";
const TENANT_A = randomUUID();
const TENANT_B = randomUUID();
const ACTOR = randomUUID();
const tok = (tid: string, roles = ["survey_officer"]) => signToken({ sub: ACTOR, tid, roles, sid: "s" }, SECRET, 3600);
const drain = () => (queue as unknown as MemoryQueue).drain();

let app: FastifyInstance;
beforeAll(async () => { registerCadastralConsumers(queue); app = await buildApp(); });
afterAll(async () => { await app.close(); await sqlClient.end(); });

const get = (url: string, tid: string, roles?: string[]) =>
  app.inject({ method: "GET", url, headers: { authorization: `Bearer ${tok(tid, roles)}` } });

describePostGIS("parcel detail by id", () => {
  const parcelNo = `P-${randomUUID().slice(0, 8)}`;
  let id = "";

  beforeAll(async () => {
    const r = await app.inject({
      method: "POST", url: "/v1/locations/cadastral/parcels",
      headers: { authorization: `Bearer ${tok(TENANT_A)}`, "content-type": "application/json" },
      payload: {
        parcelNo, village: "Rajpur", district: "Dehradun", areaSquareMeters: 1200.5,
        boundary: [{ lat: 30.3, lng: 78.0 }, { lat: 30.3, lng: 78.001 }, { lat: 30.301, lng: 78.001 }],
        landUse: "residential", ownershipType: "government",
      },
    });
    expect(r.statusCode).toBe(202);
    id = r.json().data.id;
    await drain();
  });

  it("returns the parcel", async () => {
    const r = await get(`/v1/locations/cadastral/parcels/${id}`, TENANT_A);
    expect(r.statusCode).toBe(200);
    expect(r.json().data).toMatchObject({ id, parcelNo, village: "Rajpur", district: "Dehradun", landUse: "residential", ownershipType: "government", areaSquareMeters: 1200.5 });
  });

  it("404 for an unknown id and for another tenant's parcel (no cross-tenant read)", async () => {
    expect((await get(`/v1/locations/cadastral/parcels/${randomUUID()}`, TENANT_A)).statusCode).toBe(404);
    expect((await get(`/v1/locations/cadastral/parcels/${id}`, TENANT_B)).statusCode).toBe(404);
  });

  it("the map read roles (gis_admin, location_user, project_admin) can open the parcel", async () => {
    for (const role of ["gis_admin", "location_user", "project_admin"]) {
      const r = await get(`/v1/locations/cadastral/parcels/${id}`, TENANT_A, [role]);
      expect(r.statusCode, role).toBe(200);
      expect(r.json().data.id).toBe(id);
    }
    expect((await get(`/v1/locations/cadastral/parcels/${id}`, TENANT_B, ["gis_admin"])).statusCode).toBe(404);
  });

  it("the map read roles can also read the parcel history the detail page loads", async () => {
    for (const role of ["gis_admin", "location_user", "project_admin"]) {
      const r = await get(`/v1/locations/cadastral/parcels/${id}/history`, TENANT_A, [role]);
      expect(r.statusCode, role).toBe(200);
      expect(Array.isArray(r.json().data), role).toBe(true);
    }
    const cross = await get(`/v1/locations/cadastral/parcels/${id}/history`, TENANT_B, ["gis_admin"]);
    expect(cross.statusCode).toBe(200);
    expect(cross.json().data).toEqual([]);
    expect((await get(`/v1/locations/cadastral/parcels/${id}/history`, TENANT_A, ["employee"])).statusCode).toBe(403);
  });

  it("400 for a non-UUID id; 403 without a cadastral role", async () => {
    expect((await get("/v1/locations/cadastral/parcels/not-a-uuid", TENANT_A)).statusCode).toBe(400);
    expect((await get(`/v1/locations/cadastral/parcels/${id}`, TENANT_A, ["employee"])).statusCode).toBe(403);
  });
});
