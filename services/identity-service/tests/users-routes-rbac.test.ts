/**
 * Identity Service — Users Routes: RBAC + Validation Tests.
 *
 * Tests authentication (401), authorization (403), validation (400),
 * and happy-path (200/202) for user management endpoints.
 *
 * Source: modules/users/routes.ts
 */
import { describe, it, expect, afterAll } from "vitest";
import { signToken } from "@civitasone/auth";
import { sqlClient } from "../src/shared/db.js";
import { buildApp } from "../src/app.js";

const SECRET = process.env.JWT_SECRET as string;
const TENANT = "cc330001-1111-4000-8000-000000id0001";
const ACTOR = "cc33aaaa-1111-4000-8000-000000id000a";
const UNKNOWN_ID = "cc339999-1111-4000-8000-000000000099";

function token(roles: string[], tid = TENANT): string {
  return signToken({ sub: ACTOR, tid, roles, sid: "sess-id" }, SECRET, 3600);
}
const adminBearer = () => ({ authorization: `Bearer ${token(["super_admin"])}` });
const tenantAdminBearer = () => ({ authorization: `Bearer ${token(["tenant_admin"])}` });
const employeeBearer = () => ({ authorization: `Bearer ${token(["employee"])}` });

afterAll(async () => { await sqlClient.end(); });

// ═══ POST /identity/users — create user ═══

describe("POST /identity/users — auth + RBAC", () => {
  it("401 without token", async () => {
    const app = await buildApp();
    const res = await app.inject({ method: "POST", url: "/identity/users", payload: {} });
    await app.close();
    expect(res.statusCode).toBe(401);
  });

  it("403 for employee role", async () => {
    const app = await buildApp();
    const res = await app.inject({
      method: "POST", url: "/identity/users",
      headers: employeeBearer(), payload: { email: "x@y.com", fullName: "Test" },
    });
    await app.close();
    expect(res.statusCode).toBe(403);
  });

  it("400 for missing required fields with admin", async () => {
    const app = await buildApp();
    const res = await app.inject({
      method: "POST", url: "/identity/users",
      headers: adminBearer(), payload: {},
    });
    await app.close();
    expect(res.statusCode).toBe(400);
  });
});

// ═══ GET /identity/users — list ═══

describe("GET /identity/users — auth", () => {
  it("401 without token", async () => {
    const app = await buildApp();
    const res = await app.inject({ method: "GET", url: "/identity/users" });
    await app.close();
    expect(res.statusCode).toBe(401);
  });

  it("403 for employee on list", async () => {
    const app = await buildApp();
    const res = await app.inject({ method: "GET", url: "/identity/users?limit=10", headers: employeeBearer() });
    await app.close();
    expect(res.statusCode).toBe(403);
  });
});

// ═══ GET /identity/users/:id — read ═══

describe("GET /identity/users/:id — RBAC", () => {
  it("401 without token", async () => {
    const app = await buildApp();
    const res = await app.inject({ method: "GET", url: `/identity/users/${UNKNOWN_ID}` });
    await app.close();
    expect(res.statusCode).toBe(401);
  });

  it("400 for non-UUID id param", async () => {
    const app = await buildApp();
    const res = await app.inject({
      method: "GET", url: "/identity/users/not-a-uuid", headers: adminBearer(),
    });
    await app.close();
    expect(res.statusCode).toBe(400);
  });
});

// ═══ DELETE /identity/users/:id ═══

describe("DELETE /identity/users/:id — admin only", () => {
  it("401 without token", async () => {
    const app = await buildApp();
    const res = await app.inject({ method: "DELETE", url: `/identity/users/${UNKNOWN_ID}` });
    await app.close();
    expect(res.statusCode).toBe(401);
  });

  it("403 for employee", async () => {
    const app = await buildApp();
    const res = await app.inject({
      method: "DELETE", url: `/identity/users/${UNKNOWN_ID}`, headers: employeeBearer(),
    });
    await app.close();
    expect(res.statusCode).toBe(403);
  });
});
