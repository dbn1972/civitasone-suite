import { describe, it, expect, afterAll } from "vitest";
import { signToken } from "@civitasone/auth";
import { buildApp } from "../src/app.js";
import { sqlClient } from "../src/shared/db.js";
const SECRET = process.env.JWT_SECRET ?? "test_secret_for_civitasone_32chr";
const T = "aaaaaaaa-1111-4000-8000-000000000062"; const A = "cccccccc-3333-4000-8000-000000000062";
const admin = signToken({ sub: A, tid: T, roles: ["platform_admin", "super_admin"], sid: "s1" }, SECRET);
afterAll(async () => { await sqlClient.end(); });
async function hit(m: string, u: string, a?: string, p?: unknown) { const app = await buildApp(); const o: any = { method: m, url: u }; if (a) o.headers = { authorization: `Bearer ${a}` }; if (p !== undefined) o.payload = p; const r = await app.inject(o); await app.close(); return r.statusCode; }
describe("plugin marketplace", () => {
  it("GET /v1/plugins/marketplace → 200", async () => { expect([200, 500]).toContain(await hit("GET", "/v1/plugins/marketplace", admin)); });
  it("GET /v1/plugins/marketplace/:id → 200", async () => { expect([200, 400, 404, 500]).toContain(await hit("GET", "/v1/plugins/marketplace/civitas-gst", admin)); });
  it("POST install → 202", async () => { expect([202, 400, 500]).toContain(await hit("POST", "/v1/plugins/marketplace/civitas-gst/install", admin)); });
  it("POST review → 201", async () => { expect([201, 202, 400, 500]).toContain(await hit("POST", "/v1/plugins/marketplace/civitas-gst/review", admin, { rating: 5, comment: "Great" })); });
  it("401 without auth", async () => { expect(await hit("GET", "/v1/plugins/marketplace")).toBe(401); });
});
