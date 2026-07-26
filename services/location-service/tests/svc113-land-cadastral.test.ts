/**
 * SVC-113 — Land parcel registry + cadastral registry: real round-trip persistence
 * and cross-tenant RLS isolation. Registers the real consumers on the in-memory
 * queue, drives the HTTP routes, drains the queue, and asserts the data was
 * persisted to (and isolated by) PostgreSQL.
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
import { registerLandRecordConsumers } from "../src/modules/land-records/consumer.js";
import { registerCadastralConsumers } from "../src/modules/cadastral/consumer.js";
import type { FastifyInstance } from "fastify";

const SECRET = process.env.JWT_SECRET ?? "test_secret_for_civitasone_32chr";
const TENANT_A = randomUUID();
const TENANT_B = randomUUID();
const ACTOR = randomUUID();
const tok = (tid: string) => signToken({ sub: ACTOR, tid, roles: ["location_admin", "super_admin", "revenue_officer", "survey_officer"], sid: "s" }, SECRET, 3600);

let app: FastifyInstance;
const drain = () => (queue as unknown as MemoryQueue).drain();

beforeAll(async () => {
  registerLandRecordConsumers(queue);
  registerCadastralConsumers(queue);
  app = await buildApp();
});
afterAll(async () => { await app.close(); await sqlClient.end(); });

async function post(url: string, tid: string, payload: unknown) {
  return app.inject({ method: "POST", url, headers: { authorization: `Bearer ${tok(tid)}`, "content-type": "application/json" }, payload });
}
async function get(url: string, tid: string) {
  return app.inject({ method: "GET", url, headers: { authorization: `Bearer ${tok(tid)}` } });
}

describePostGIS("SVC-113 land-records round-trip", () => {
  const surveyNo = `SN-${Date.now()}`;

  it("persists a land record and reads it back", async () => {
    const res = await post("/v1/locations/land-records", TENANT_A, {
      surveyNo, village: "Rajpur", district: "Dehradun", areaHectares: 2.5, ownerName: "Ram Kumar", landType: "agricultural",
    });
    expect(res.statusCode).toBe(202);
    await drain();
    const list = await get("/v1/locations/land-records", TENANT_A);
    expect(list.statusCode).toBe(200);
    const rec = list.json().data.find((r: { surveyNo: string }) => r.surveyNo === surveyNo);
    expect(rec).toBeTruthy();
    expect(rec.ownerName).toBe("Ram Kumar");
    expect(rec.areaHectares).toBe(2.5);
  });

  it("applies a mutation (owner change + version bump)", async () => {
    const list = await get("/v1/locations/land-records", TENANT_A);
    const rec = list.json().data.find((r: { surveyNo: string }) => r.surveyNo === surveyNo);
    const res = await post(`/v1/locations/land-records/${rec.id}/mutation`, TENANT_A, { newOwnerName: "Sita Devi", mutationType: "sale" });
    expect(res.statusCode).toBe(202);
    await drain();
    const one = await get(`/v1/locations/land-records/${rec.id}`, TENANT_A);
    expect(one.statusCode).toBe(200);
    expect(one.json().data.ownerName).toBe("Sita Devi");
    expect(one.json().data.mutationType).toBe("sale");
    expect(one.json().data.version).toBe(2);
  });

  it("isolates land records across tenants (RLS)", async () => {
    const listB = await get("/v1/locations/land-records", TENANT_B);
    expect(listB.statusCode).toBe(200);
    const leaked = listB.json().data.filter((r: { surveyNo: string }) => r.surveyNo === surveyNo);
    expect(leaked).toHaveLength(0);
  });
});

describePostGIS("SVC-113 cadastral round-trip", () => {
  const parcelNo = `P-${Date.now()}`;
  let parcelId = "";

  it("persists a cadastral parcel with PostGIS boundary and history", async () => {
    const res = await post("/v1/locations/cadastral/parcels", TENANT_A, {
      parcelNo, village: "Rajpur", district: "Dehradun", areaSquareMeters: 12000.5,
      boundary: [{ lat: 30.0, lng: 78.0 }, { lat: 30.0, lng: 78.01 }, { lat: 30.01, lng: 78.01 }, { lat: 30.01, lng: 78.0 }],
      landUse: "agricultural", ownershipType: "private",
    });
    expect(res.statusCode).toBe(202);
    parcelId = res.json().data.id;
    await drain();
    const list = await get("/v1/locations/cadastral/parcels", TENANT_A);
    expect(list.statusCode).toBe(200);
    const p = list.json().data.find((r: { parcelNo: string }) => r.parcelNo === parcelNo);
    expect(p).toBeTruthy();
    expect(p.areaSquareMeters).toBe(12000.5);
    const hist = await get(`/v1/locations/cadastral/parcels/${parcelId}/history`, TENANT_A);
    expect(hist.statusCode).toBe(200);
    expect(hist.json().data[0].eventType).toBe("registered");
  });

  it("schedules a survey and files a dispute without DLQ errors", async () => {
    const s = await post("/v1/locations/cadastral/survey", TENANT_A, {
      parcelIds: [parcelId], surveyorId: randomUUID(), scheduledDate: new Date(Date.now() + 86400000).toISOString(),
    });
    expect(s.statusCode).toBe(202);
    const d = await post("/v1/locations/cadastral/boundary-dispute", TENANT_A, {
      parcelAId: parcelId, parcelBId: randomUUID(), description: "overlap along eastern edge",
    });
    expect(d.statusCode).toBe(202);
    await drain();
    expect((queue as unknown as MemoryQueue).dlq.length).toBe(0);
  });

  it("isolates parcels across tenants (RLS)", async () => {
    const listB = await get("/v1/locations/cadastral/parcels", TENANT_B);
    expect(listB.statusCode).toBe(200);
    const leaked = listB.json().data.filter((r: { parcelNo: string }) => r.parcelNo === parcelNo);
    expect(leaked).toHaveLength(0);
  });
});
