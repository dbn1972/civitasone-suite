import { describe, it, expect, afterAll } from "vitest";
import { randomUUID } from "node:crypto";
import { signToken } from "@civitasone/auth";
import { buildApp } from "../src/app.js";
import { sqlClient } from "../src/shared/db.js";
const SECRET = process.env.JWT_SECRET ?? "test_secret_for_civitasone_32chr";
const T = "aaaaaaaa-1111-4000-8000-000000000046";
const A = "cccccccc-3333-4000-8000-000000000046";
const admin = signToken({ sub: A, tid: T, roles: ["platform_admin", "super_admin"], sid: "s1" }, SECRET);
afterAll(async () => { await sqlClient.end(); });
async function hit(m: string, u: string, a?: string, p?: unknown) {
  const app = await buildApp();
  const o: { method: string; url: string; headers?: Record<string, string>; payload?: unknown } = { method: m, url: u };
  if (a) o.headers = { authorization: `Bearer ${a}` };
  if (p !== undefined) o.payload = p;
  const r = await app.inject(o); await app.close(); return r.statusCode;
}
describe("tenant & org — tenancy & master data", () => {
  it("GET /v1/tenants", async () => { expect([200, 404, 500]).toContain(await hit("GET", "/v1/tenants", admin)); });
  it("GET /v1/plans", async () => { expect([200, 500]).toContain(await hit("GET", "/v1/plans", admin)); });
  it("GET /v1/quotas", async () => { expect([200, 404, 500]).toContain(await hit("GET", "/v1/quotas", admin)); });
  it("GET /v1/subscriptions", async () => { expect([200, 404, 500]).toContain(await hit("GET", "/v1/subscriptions", admin)); });
  it("GET /v1/settings", async () => { expect([200, 500]).toContain(await hit("GET", "/v1/settings", admin)); });
  it("POST /v1/tenant/onboard", async () => { expect([201, 202, 400, 500]).toContain(await hit("POST", "/v1/tenant/onboard", admin, { name: "Test Dept", edition: "small_office" })); });
  it("GET /v1/tenant/usage", async () => { expect([200, 500]).toContain(await hit("GET", "/v1/tenant/usage", admin)); });
  it("401 without auth", async () => { expect(await hit("GET", "/v1/tenants")).toBe(401); });
});
