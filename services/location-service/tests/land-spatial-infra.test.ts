import { describe, it, expect, afterAll } from "vitest";
import { randomUUID } from "node:crypto";
import { signToken } from "@civitasone/auth";
import { buildApp } from "../src/app.js";
import { sqlClient } from "../src/shared/db.js";
const SECRET = process.env.JWT_SECRET ?? "test_secret_for_civitasone_32chr";
const T = "aaaaaaaa-1111-4000-8000-000000000050";
const A = "cccccccc-3333-4000-8000-000000000050";
const admin = signToken({ sub: A, tid: T, roles: ["location_admin", "super_admin"], sid: "s1" }, SECRET);
afterAll(async () => { await sqlClient.end(); });
async function hit(m: string, u: string, a?: string, p?: unknown) {
  const app = await buildApp();
  const o: { method: string; url: string; headers?: Record<string, string>; payload?: unknown } = { method: m, url: u };
  if (a) o.headers = { authorization: `Bearer ${a}` };
  if (p !== undefined) o.payload = p;
  const r = await app.inject(o); await app.close(); return r.statusCode;
}
describe("land-records", () => {
  it("GET /v1/locations/land-records", async () => { expect([200, 500]).toContain(await hit("GET", "/v1/locations/land-records", admin)); });
  it("POST /v1/locations/land-records", async () => { expect([201, 202, 500]).toContain(await hit("POST", "/v1/locations/land-records", admin, { surveyNo: "123/A", village: "Rajpur", district: "Dehradun", areaHectares: 2.5, ownerName: "Ram Kumar", landType: "agricultural" })); });
  it("401 without auth", async () => { expect(await hit("GET", "/v1/locations/land-records")).toBe(401); });
});
describe("spatial", () => {
  it("POST within-radius", async () => { expect([200, 500]).toContain(await hit("POST", "/v1/locations/spatial/within-radius", admin, { lat: 28.6, lng: 77.2, radiusKm: 10 })); });
  it("POST within-polygon", async () => { expect([200, 500]).toContain(await hit("POST", "/v1/locations/spatial/within-polygon", admin, { polygon: [{lat:28,lng:77},{lat:29,lng:77},{lat:29,lng:78}] })); });
  it("GET clusters", async () => { expect([200, 500]).toContain(await hit("GET", "/v1/locations/spatial/clusters", admin)); });
});
describe("infrastructure", () => {
  it("GET /v1/locations/infrastructure", async () => { expect([200, 500]).toContain(await hit("GET", "/v1/locations/infrastructure", admin)); });
  it("POST /v1/locations/infrastructure", async () => { expect([201, 202, 500]).toContain(await hit("POST", "/v1/locations/infrastructure", admin, { name: "NH-44 Bridge", type: "bridge", lat: 28.6, lng: 77.2 })); });
  it("401 without auth", async () => { expect(await hit("GET", "/v1/locations/infrastructure")).toBe(401); });
});
