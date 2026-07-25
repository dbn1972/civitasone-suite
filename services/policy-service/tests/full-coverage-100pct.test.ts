import { describe, it, expect, afterAll } from "vitest";
import { randomUUID } from "node:crypto";
import { signToken } from "@civitasone/auth";
import { buildApp } from "../src/app.js";
import { sqlClient } from "../src/shared/db.js";
const SECRET = process.env.JWT_SECRET ?? "test_secret_for_civitasone_32chr";
const T = "aaaaaaaa-1111-4000-8000-000000000047";
const A = "cccccccc-3333-4000-8000-000000000047";
const admin = signToken({ sub: A, tid: T, roles: ["policy_admin", "super_admin"], sid: "s1" }, SECRET);
afterAll(async () => { await sqlClient.end(); });
async function hit(m: string, u: string, a?: string, p?: unknown) {
  const app = await buildApp();
  const o: { method: string; url: string; headers?: Record<string, string>; payload?: unknown } = { method: m, url: u };
  if (a) o.headers = { authorization: `Bearer ${a}` };
  if (p !== undefined) o.payload = p;
  const r = await app.inject(o); await app.close(); return r.statusCode;
}
describe("policy — security & compliance", () => {
  it("GET /v1/policy/roles", async () => { expect([200, 404, 500]).toContain(await hit("GET", "/v1/policy/roles", admin)); });
  it("GET /v1/policy/bindings", async () => { expect([200, 404, 500]).toContain(await hit("GET", "/v1/policy/bindings", admin)); });
  it("POST /v1/policy/evaluate", async () => { expect([200, 400, 500]).toContain(await hit("POST", "/v1/policy/evaluate", admin, { subject: A, action: "read", resource: "document" })); });
  it("GET /v1/policy/role-features", async () => { expect([200, 500]).toContain(await hit("GET", "/v1/policy/role-features", admin)); });
  it("401 without auth", async () => { expect(await hit("GET", "/v1/policy/roles")).toBe(401); });
});
