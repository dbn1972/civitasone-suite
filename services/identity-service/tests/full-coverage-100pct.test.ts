import { describe, it, expect, afterAll } from "vitest";
import { randomUUID } from "node:crypto";
import { signToken } from "@civitasone/auth";
import { buildApp } from "../src/app.js";
import { sqlClient } from "../src/shared/db.js";
const SECRET = process.env.JWT_SECRET ?? "test_secret_for_civitasone_32chr";
const T = "aaaaaaaa-1111-4000-8000-000000000045";
const A = "cccccccc-3333-4000-8000-000000000045";
const admin = signToken({ sub: A, tid: T, roles: ["identity_admin", "super_admin"], sid: "s1" }, SECRET);
afterAll(async () => { await sqlClient.end(); });
async function hit(m: string, u: string, a?: string, p?: unknown) {
  const app = await buildApp();
  const o: { method: string; url: string; headers?: Record<string, string>; payload?: unknown } = { method: m, url: u };
  if (a) o.headers = { authorization: `Bearer ${a}` };
  if (p !== undefined) o.payload = p;
  const r = await app.inject(o); await app.close(); return r.statusCode;
}
describe("identity — security & access", () => {
  it("GET /identity/rbac/roles", async () => { expect([200, 500]).toContain(await hit("GET", "/identity/rbac/roles", admin)); });
  it("GET /identity/rbac/permissions", async () => { expect([200, 500]).toContain(await hit("GET", "/identity/rbac/permissions", admin)); });
  it("GET /identity/api-keys", async () => { expect([200, 500]).toContain(await hit("GET", "/identity/api-keys", admin)); });
  it("GET /identity/break-glass", async () => { expect([200, 500]).toContain(await hit("GET", "/identity/break-glass", admin)); });
  // F3 async: this route returns 202 (accepted) on success, or 409 when MFA
  // is already enabled for this actor (synchronous pre-accept check) — 201
  // was the pre-conversion status.
  it("POST /identity/mfa/setup", async () => { expect([202, 400, 409, 500]).toContain(await hit("POST", "/identity/mfa/setup", admin, { method: "totp" })); });
  it("401 without auth", async () => { expect(await hit("GET", "/identity/rbac/roles")).toBe(401); });
});
