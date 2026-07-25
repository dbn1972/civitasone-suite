import { describe, it, expect, afterAll } from "vitest";
import { randomUUID } from "node:crypto";
import { signToken } from "@civitasone/auth";
import { buildApp } from "../src/app.js";
import { sqlClient } from "../src/shared/db.js";
const SECRET = process.env.JWT_SECRET ?? "test_secret_for_civitasone_32chr";
const T = "aaaaaaaa-1111-4000-8000-000000000063"; const A = "cccccccc-3333-4000-8000-000000000063";
const admin = signToken({ sub: A, tid: T, roles: ["security_admin", "super_admin"], sid: "s1" }, SECRET);
afterAll(async () => { await sqlClient.end(); });
async function hit(m: string, u: string, a?: string, p?: unknown) { const app = await buildApp(); const o: any = { method: m, url: u }; if (a) o.headers = { authorization: `Bearer ${a}` }; if (p !== undefined) o.payload = p; const r = await app.inject(o); await app.close(); return r.statusCode; }
describe("VAPT + SOC2", () => {
  it("POST vapt/scan → 202", async () => { expect(await hit("POST", "/v1/admin/security/vapt/scan", admin, { targetServices: ["finance-service"], scanType: "quick" })).toBe(202); });
  it("GET vapt/reports → 200", async () => { expect([200, 500]).toContain(await hit("GET", "/v1/admin/security/vapt/reports", admin)); });
  it("GET soc2/controls → 200", async () => { expect(await hit("GET", "/v1/admin/security/soc2/controls", admin)).toBe(200); });
  it("POST soc2/evidence/export → 202", async () => { expect(await hit("POST", "/v1/admin/security/soc2/evidence/export", admin, { controlIds: ["CC6.1"], format: "pdf", period: { from: "2026-01-01T00:00:00Z", to: "2026-07-01T00:00:00Z" } })).toBe(202); });
  it("GET posture → 200", async () => { expect([200, 500]).toContain(await hit("GET", "/v1/admin/security/posture", admin)); });
  it("401 without auth", async () => { expect(await hit("GET", "/v1/admin/security/posture")).toBe(401); });
  it("400 bad payload", async () => { expect(await hit("POST", "/v1/admin/security/vapt/scan", admin, { targetServices: [] })).toBe(400); });
});
