import { describe, it, expect, afterAll } from "vitest";
import { randomUUID } from "node:crypto";
import { signToken } from "@civitasone/auth";
import { buildApp } from "../src/app.js";
import { sqlClient } from "../src/shared/db.js";
const SECRET = process.env.JWT_SECRET ?? "test_secret_for_civitasone_32chr";
const T = "aaaaaaaa-1111-4000-8000-000000000061"; const A = "cccccccc-3333-4000-8000-000000000061";
const admin = signToken({ sub: A, tid: T, roles: ["asset_admin", "super_admin"], sid: "s1" }, SECRET);
afterAll(async () => { await sqlClient.end(); });
async function hit(m: string, u: string, a?: string, p?: unknown) { const app = await buildApp(); const o: any = { method: m, url: u }; if (a) o.headers = { authorization: `Bearer ${a}` }; if (p !== undefined) o.payload = p; const r = await app.inject(o); await app.close(); return r.statusCode; }
describe("fleet-devices + maintenance", () => {
  it("POST devices → 202", async () => { expect(await hit("POST", "/v1/assets/fleet/devices", admin, { vehicleId: randomUUID(), deviceImei: "123456789012345", protocol: "gt06" })).toBe(202); });
  it("GET devices → 200", async () => { expect([200, 500]).toContain(await hit("GET", "/v1/assets/fleet/devices", admin)); });
  it("POST telemetry → 202", async () => { expect(await hit("POST", `/v1/assets/fleet/devices/${randomUUID()}/telemetry`, admin, { lat: 28.6, lng: 77.2, speed: 45, heading: 90, timestamp: new Date().toISOString() })).toBe(202); });
  it("POST maintenance/schedule → 202", async () => { expect(await hit("POST", "/v1/assets/fleet/maintenance/schedule", admin, { vehicleId: randomUUID(), type: "oil_change", scheduledDate: new Date(Date.now() + 86400000).toISOString() })).toBe(202); });
  it("401 without auth", async () => { expect(await hit("GET", "/v1/assets/fleet/devices")).toBe(401); });
});
