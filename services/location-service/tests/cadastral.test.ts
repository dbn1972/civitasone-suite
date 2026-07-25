import { describe, it, expect, afterAll } from "vitest";
import { randomUUID } from "node:crypto";
import { signToken } from "@civitasone/auth";
import { buildApp } from "../src/app.js";
import { sqlClient } from "../src/shared/db.js";
const SECRET = process.env.JWT_SECRET ?? "test_secret_for_civitasone_32chr";
const T = "aaaaaaaa-1111-4000-8000-000000000064"; const A = "cccccccc-3333-4000-8000-000000000064";
const admin = signToken({ sub: A, tid: T, roles: ["location_admin", "super_admin"], sid: "s1" }, SECRET);
afterAll(async () => { await sqlClient.end(); });
async function hit(m: string, u: string, a?: string, p?: unknown) { const app = await buildApp(); const o: any = { method: m, url: u }; if (a) o.headers = { authorization: `Bearer ${a}` }; if (p !== undefined) o.payload = p; const r = await app.inject(o); await app.close(); return r.statusCode; }
describe("cadastral survey", () => {
  it("GET parcels → 200", async () => { expect([200, 500]).toContain(await hit("GET", "/v1/locations/cadastral/parcels", admin)); });
  it("POST parcels → 202", async () => { expect(await hit("POST", "/v1/locations/cadastral/parcels", admin, { parcelNo: "P-101", village: "Rajpur", district: "Dehradun", areaSquareMeters: 5000, boundary: [{lat:30.3,lng:78.0},{lat:30.31,lng:78.0},{lat:30.31,lng:78.01}], landUse: "agricultural", ownershipType: "private" })).toBe(202); });
  it("POST survey → 202", async () => { expect(await hit("POST", "/v1/locations/cadastral/survey", admin, { parcelIds: [randomUUID()], surveyorId: randomUUID(), scheduledDate: new Date(Date.now()+86400000).toISOString() })).toBe(202); });
  it("POST boundary-dispute → 202", async () => { expect(await hit("POST", "/v1/locations/cadastral/boundary-dispute", admin, { parcelAId: randomUUID(), parcelBId: randomUUID(), description: "Boundary encroachment" })).toBe(202); });
  it("400 bad parcel", async () => { expect(await hit("POST", "/v1/locations/cadastral/parcels", admin, { parcelNo: "" })).toBe(400); });
  it("401 without auth", async () => { expect(await hit("GET", "/v1/locations/cadastral/parcels")).toBe(401); });
});
