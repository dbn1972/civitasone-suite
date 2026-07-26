/**
 * SVC-117 — KML/GeoJSON spatial exchange: import a GeoJSON FeatureCollection and
 * a KML document, then export the dataset back out as GeoJSON and KML. Proves
 * round-trip persistence and tenant isolation.
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
const tok = (tid: string) => signToken({ sub: ACTOR, tid, roles: ["location_admin", "gis_admin"], sid: "s" }, SECRET, 3600);

let app: FastifyInstance;
beforeAll(async () => { app = await buildApp(); });
afterAll(async () => { await app.close(); await sqlClient.end(); });

const post = (url: string, tid: string, payload: unknown) =>
  app.inject({ method: "POST", url, headers: { authorization: `Bearer ${tok(tid)}`, "content-type": "application/json" }, payload });
const get = (url: string, tid: string) => app.inject({ method: "GET", url, headers: { authorization: `Bearer ${tok(tid)}` } });

const FC = {
  type: "FeatureCollection",
  features: [
    { type: "Feature", geometry: { type: "Point", coordinates: [77.2, 28.6] }, properties: { name: "office-1", kind: "hq" } },
    { type: "Feature", geometry: { type: "LineString", coordinates: [[77.0, 28.0], [77.1, 28.1]] }, properties: { name: "road-1" } },
    { type: "Feature", geometry: { type: "Polygon", coordinates: [[[77.0, 28.0], [77.1, 28.0], [77.1, 28.1], [77.0, 28.0]]] }, properties: { name: "zone-1" } },
  ],
};

describe("SVC-117 GeoJSON round-trip", () => {
  const dataset = `gj-${Date.now()}`;

  it("imports a FeatureCollection", async () => {
    const res = await post("/v1/locations/spatial-exchange/import", TENANT_A, { dataset, format: "geojson", data: FC });
    expect(res.statusCode).toBe(201);
    expect(res.json().data.imported).toBe(3);
  });

  it("exports the dataset back as GeoJSON with the same geometries", async () => {
    const res = await get(`/v1/locations/spatial-exchange/export?dataset=${dataset}&format=geojson`, TENANT_A);
    expect(res.statusCode).toBe(200);
    const out = res.json();
    expect(out.type).toBe("FeatureCollection");
    expect(out.features).toHaveLength(3);
    const types = out.features.map((f: { geometry: { type: string } }) => f.geometry.type).sort();
    expect(types).toEqual(["LineString", "Point", "Polygon"]);
    const point = out.features.find((f: { geometry: { type: string } }) => f.geometry.type === "Point");
    expect(point.geometry.coordinates[0]).toBeCloseTo(77.2, 5);
    expect(point.geometry.coordinates[1]).toBeCloseTo(28.6, 5);
    expect(point.properties.name).toBe("office-1");
  });

  it("exports the dataset as KML", async () => {
    const res = await get(`/v1/locations/spatial-exchange/export?dataset=${dataset}&format=kml`, TENANT_A);
    expect(res.statusCode).toBe(200);
    expect(res.headers["content-type"]).toContain("kml");
    expect(res.body).toContain("<Placemark>");
    expect(res.body).toContain("<Point>");
    expect(res.body).toContain("office-1");
  });

  it("does not leak the dataset to another tenant (RLS)", async () => {
    const res = await get(`/v1/locations/spatial-exchange/export?dataset=${dataset}&format=geojson`, TENANT_B);
    expect(res.statusCode).toBe(200);
    expect(res.json().features).toHaveLength(0);
  });
});

describe("SVC-117 KML import", () => {
  const dataset = `kml-${Date.now()}`;
  const KML = `<?xml version="1.0"?><kml xmlns="http://www.opengis.net/kml/2.2"><Document>
    <Placemark><name>pt-a</name><Point><coordinates>77.25,28.65,0</coordinates></Point></Placemark>
    <Placemark><name>line-a</name><LineString><coordinates>77.0,28.0 77.2,28.2</coordinates></LineString></Placemark>
  </Document></kml>`;

  it("imports KML placemarks and exports them as GeoJSON", async () => {
    const imp = await post("/v1/locations/spatial-exchange/import", TENANT_A, { dataset, format: "kml", data: KML });
    expect(imp.statusCode).toBe(201);
    expect(imp.json().data.imported).toBe(2);
    const exp = await get(`/v1/locations/spatial-exchange/export?dataset=${dataset}&format=geojson`, TENANT_A);
    expect(exp.json().features).toHaveLength(2);
    const pt = exp.json().features.find((f: { geometry: { type: string } }) => f.geometry.type === "Point");
    expect(pt.geometry.coordinates[0]).toBeCloseTo(77.25, 4);
  });

  it("rejects invalid GeoJSON", async () => {
    const res = await post("/v1/locations/spatial-exchange/import", TENANT_A, { dataset: "bad", format: "geojson", data: { type: "Nope" } });
    expect(res.statusCode).toBe(400);
  });
});
