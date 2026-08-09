/**
 * Admin Service — Route-Level RBAC Tests.
 *
 * Tests authentication (401) and authorization (403) for API key endpoints.
 * Allowed roles: platform_admin, super_admin, tenant_admin
 * Blocked role: employee
 */
import { describe, it, expect, afterAll } from "vitest";
import { signToken } from "@civitasone/auth";
import { sqlClient } from "../src/shared/db.js";
import { buildApp } from "../src/app.js";

const SECRET = process.env.JWT_SECRET as string;
const TENANT = "aa330001-3333-4000-8000-000000a30001";
const ACTOR = "aa33aaaa-3333-4000-8000-000000a3000a";

function token(roles: string[]): string {
  return signToken({ sub: ACTOR, tid: TENANT, roles, sid: "sess-adm" }, SECRET, 3600);
}

const blockedBearer = () => ({ authorization: `Bearer ${token(["employee"])}` });

afterAll(async () => { await sqlClient.end(); });

// ═══ POST /v1/admin/api-keys — write endpoint ═══

describe("POST /v1/admin/api-keys — auth", () => {
  it("401 without token", async () => {
    const app = await buildApp();
    const res = await app.inject({ method: "POST", url: "/v1/admin/api-keys", payload: {} });
    await app.close();
    expect(res.statusCode).toBe(401);
  });

  it("403 for employee role", async () => {
    const app = await buildApp();
    const res = await app.inject({
      method: "POST", url: "/v1/admin/api-keys",
      headers: blockedBearer(),
      payload: { name: "test-key", scopes: ["read"] },
    });
    await app.close();
    expect(res.statusCode).toBe(403);
  });
});

// ═══ GET /v1/admin/api-keys — read endpoint ═══

describe("GET /v1/admin/api-keys — auth", () => {
  it("401 without token", async () => {
    const app = await buildApp();
    const res = await app.inject({ method: "GET", url: "/v1/admin/api-keys" });
    await app.close();
    expect(res.statusCode).toBe(401);
  });

  it("403 for employee role", async () => {
    const app = await buildApp();
    const res = await app.inject({
      method: "GET", url: "/v1/admin/api-keys",
      headers: blockedBearer(),
    });
    await app.close();
    expect(res.statusCode).toBe(403);
  });
});
