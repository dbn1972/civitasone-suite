/**
 * Policy Service — Route-Level RBAC Tests.
 *
 * Tests authentication (401) and authorization (403) for ABAC rules endpoints.
 * Allowed roles: platform_admin, super_admin, tenant_admin
 * Blocked role: employee
 */
import { describe, it, expect, afterAll } from "vitest";
import { signToken } from "@civitasone/auth";
import { sqlClient } from "../src/shared/db.js";
import { buildApp } from "../src/app.js";

const SECRET = process.env.JWT_SECRET as string;
const TENANT = "aa220001-2222-4000-8000-000000a20001";
const ACTOR = "aa22aaaa-2222-4000-8000-000000a2000a";

function token(roles: string[]): string {
  return signToken({ sub: ACTOR, tid: TENANT, roles, sid: "sess-pol" }, SECRET, 3600);
}

const blockedBearer = () => ({ authorization: `Bearer ${token(["employee"])}` });

afterAll(async () => { await sqlClient.end(); });

// ═══ POST /v1/policy/abac/rules — write endpoint ═══

describe("POST /v1/policy/abac/rules — auth", () => {
  it("401 without token", async () => {
    const app = await buildApp();
    const res = await app.inject({ method: "POST", url: "/v1/policy/abac/rules", payload: {} });
    await app.close();
    expect(res.statusCode).toBe(401);
  });

  it("403 for employee role", async () => {
    const app = await buildApp();
    const res = await app.inject({
      method: "POST", url: "/v1/policy/abac/rules",
      headers: blockedBearer(),
      payload: { resource: "projects", action: "create", effect: "allow" },
    });
    await app.close();
    expect(res.statusCode).toBe(403);
  });
});

// ═══ GET /v1/policy/abac/rules — read endpoint ═══

describe("GET /v1/policy/abac/rules — auth", () => {
  it("401 without token", async () => {
    const app = await buildApp();
    const res = await app.inject({ method: "GET", url: "/v1/policy/abac/rules" });
    await app.close();
    expect(res.statusCode).toBe(401);
  });

  it("403 for employee role", async () => {
    const app = await buildApp();
    const res = await app.inject({
      method: "GET", url: "/v1/policy/abac/rules",
      headers: blockedBearer(),
    });
    await app.close();
    expect(res.statusCode).toBe(403);
  });
});
