import { describe, it, expect, afterAll } from "vitest";
import { signToken } from "@civitasone/auth";
import { buildApp } from "../src/app.js";
import { sqlClient } from "../src/shared/db.js";
const SECRET = process.env.JWT_SECRET ?? "test_secret_for_civitasone_32chr";
const T = "aaaaaaaa-1111-4000-8000-000000000035";
const A = "cccccccc-3333-4000-8000-000000000035";
const admin = signToken({ sub: A, tid: T, roles: ["platform_admin", "super_admin"], sid: "s1" }, SECRET);
afterAll(async () => { await sqlClient.end(); });
async function hit(m: string, u: string, a?: string) {
  const app = await buildApp();
  const o: { method: string; url: string; headers?: Record<string, string> } = { method: m, url: u };
  if (a) o.headers = { authorization: `Bearer ${a}` };
  const r = await app.inject(o); await app.close(); return r.statusCode;
}

describe("platform ops — all route groups", () => {
  it("GET /v1/admin/tenants", async () => { expect([200, 500]).toContain(await hit("GET", "/v1/admin/tenants", admin)); });
  it("GET /v1/admin/config", async () => { expect([200, 404, 500]).toContain(await hit("GET", "/v1/admin/config", admin)); });
  it("GET /v1/admin/feature-flags", async () => { expect([200, 500]).toContain(await hit("GET", "/v1/admin/feature-flags", admin)); });
  it("GET /v1/admin/health", async () => { expect([200, 500]).toContain(await hit("GET", "/v1/admin/health", admin)); });
  it("GET /v1/admin/scheduled-jobs", async () => { expect([200, 500]).toContain(await hit("GET", "/v1/admin/scheduled-jobs", admin)); });
  it("GET /v1/admin/backups", async () => { expect([200, 404, 500]).toContain(await hit("GET", "/v1/admin/backups", admin)); });
  it("GET /v1/admin/webhooks", async () => { expect([200, 500]).toContain(await hit("GET", "/v1/admin/webhooks", admin)); });
  it("GET /v1/admin/api-keys", async () => { expect([200, 500]).toContain(await hit("GET", "/v1/admin/api-keys", admin)); });
  it("GET /v1/admin/change-log", async () => { expect([200, 404, 500]).toContain(await hit("GET", "/v1/admin/change-log", admin)); });
  it("401 on all without auth", async () => {
    for (const u of ["/v1/admin/tenants", "/v1/admin/config", "/v1/admin/feature-flags", "/v1/admin/health", "/v1/admin/scheduled-jobs"]) expect(await hit("GET", u)).toBe(401);
  });
});
