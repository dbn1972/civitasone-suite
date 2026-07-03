/**
 * policy-service — role-features route tests.
 * Tests CRUD, evaluate, auth, and validation.
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { signToken } from "@civitasone/auth";
import type { FastifyInstance } from "fastify";
import { buildApp } from "../src/app.js";
import { sqlClient } from "../src/shared/db.js";

const SECRET = "test_secret_for_civitasone_32chr";
const TENANT = "aaaaaaaa-cccc-4000-8000-000000000001";
const ACTOR = "00000000-cccc-4000-8000-000000000002";
const VALID_UUID = "11111111-cccc-4000-8000-333333333333";

function token(roles: string[] = ["super_admin"], tenantId = TENANT): string {
  return signToken({ sub: ACTOR, tid: tenantId, roles, sid: "sess-rf" }, SECRET, 3600);
}

function authHeader(roles?: string[], tenantId?: string) {
  return { authorization: `Bearer ${token(roles, tenantId)}` };
}

let app: FastifyInstance;

beforeAll(async () => { app = await buildApp(); });
afterAll(async () => { await app.close(); await sqlClient.end(); });

// ══════════════════════════════════════════════════════════════════════════════
// GET /v1/policy/role-features — LIST ALL
// ══════════════════════════════════════════════════════════════════════════════
describe("GET /v1/policy/role-features", () => {
  it("does not return 403 for super_admin", async () => {
    const res = await app.inject({ method: "GET", url: "/v1/policy/role-features", headers: authHeader(["super_admin"]) });
    expect(res.statusCode).not.toBe(403);
    expect(res.statusCode).not.toBe(401);
  });

  it("does not return 403 for tenant_admin", async () => {
    const res = await app.inject({ method: "GET", url: "/v1/policy/role-features", headers: authHeader(["tenant_admin"]) });
    expect(res.statusCode).not.toBe(403);
    expect(res.statusCode).not.toBe(401);
  });

  it("returns 403 for employee", async () => {
    const res = await app.inject({ method: "GET", url: "/v1/policy/role-features", headers: authHeader(["employee"]) });
    expect(res.statusCode).toBe(403);
  });

  it("returns 401 without token", async () => {
    const res = await app.inject({ method: "GET", url: "/v1/policy/role-features" });
    expect(res.statusCode).toBe(401);
  });
});

// ══════════════════════════════════════════════════════════════════════════════
// GET /v1/policy/role-features/by-role/:role
// ══════════════════════════════════════════════════════════════════════════════
describe("GET /v1/policy/role-features/by-role/:role", () => {
  it("does not return 403 for super_admin with valid role", async () => {
    const res = await app.inject({ method: "GET", url: "/v1/policy/role-features/by-role/finance_clerk", headers: authHeader(["super_admin"]) });
    expect(res.statusCode).not.toBe(403);
    expect(res.statusCode).not.toBe(401);
  });

  it("returns 403 for employee", async () => {
    const res = await app.inject({ method: "GET", url: "/v1/policy/role-features/by-role/finance_clerk", headers: authHeader(["employee"]) });
    expect(res.statusCode).toBe(403);
  });
});

// ══════════════════════════════════════════════════════════════════════════════
// POST /v1/policy/role-features — GRANT
// ══════════════════════════════════════════════════════════════════════════════
describe("POST /v1/policy/role-features", () => {
  it("returns 202 with valid grant body", async () => {
    const res = await app.inject({
      method: "POST", url: "/v1/policy/role-features",
      headers: authHeader(["super_admin"]),
      payload: { roleName: "finance_clerk", featureKey: "finance.dashboard", granted: true },
    });
    expect(res.statusCode).toBe(202);
    const body = res.json();
    expect(body.id).toBeDefined();
    expect(body.status).toBe("accepted");
  });

  it("returns 202 with minimal body (granted defaults to true)", async () => {
    const res = await app.inject({
      method: "POST", url: "/v1/policy/role-features",
      headers: authHeader(["tenant_admin"]),
      payload: { roleName: "hr_admin", featureKey: "hrms.employees" },
    });
    expect(res.statusCode).toBe(202);
  });

  it("returns 400 with missing roleName", async () => {
    const res = await app.inject({
      method: "POST", url: "/v1/policy/role-features",
      headers: authHeader(["super_admin"]),
      payload: { featureKey: "finance.dashboard" },
    });
    expect(res.statusCode).toBe(400);
  });

  it("returns 400 with missing featureKey", async () => {
    const res = await app.inject({
      method: "POST", url: "/v1/policy/role-features",
      headers: authHeader(["super_admin"]),
      payload: { roleName: "finance_clerk" },
    });
    expect(res.statusCode).toBe(400);
  });

  it("returns 400 with empty roleName", async () => {
    const res = await app.inject({
      method: "POST", url: "/v1/policy/role-features",
      headers: authHeader(["super_admin"]),
      payload: { roleName: "", featureKey: "finance.dashboard" },
    });
    expect(res.statusCode).toBe(400);
  });

  it("returns 403 for employee", async () => {
    const res = await app.inject({
      method: "POST", url: "/v1/policy/role-features",
      headers: authHeader(["employee"]),
      payload: { roleName: "hr_admin", featureKey: "hrms.employees" },
    });
    expect(res.statusCode).toBe(403);
  });
});

// ══════════════════════════════════════════════════════════════════════════════
// DELETE /v1/policy/role-features/:id — REVOKE
// ══════════════════════════════════════════════════════════════════════════════
describe("DELETE /v1/policy/role-features/:id", () => {
  it("returns 202 for super_admin", async () => {
    const res = await app.inject({
      method: "DELETE", url: `/v1/policy/role-features/${VALID_UUID}`,
      headers: authHeader(["super_admin"]),
    });
    expect(res.statusCode).toBe(202);
  });

  it("returns 400 with invalid uuid", async () => {
    const res = await app.inject({
      method: "DELETE", url: "/v1/policy/role-features/not-uuid",
      headers: authHeader(["super_admin"]),
    });
    expect(res.statusCode).toBe(400);
  });

  it("returns 403 for employee", async () => {
    const res = await app.inject({
      method: "DELETE", url: `/v1/policy/role-features/${VALID_UUID}`,
      headers: authHeader(["employee"]),
    });
    expect(res.statusCode).toBe(403);
  });
});

// ══════════════════════════════════════════════════════════════════════════════
// GET /v1/policy/role-features/evaluate
// ══════════════════════════════════════════════════════════════════════════════
describe("GET /v1/policy/role-features/evaluate", () => {
  it("does not return 403 for super_admin with roles query", async () => {
    const res = await app.inject({
      method: "GET", url: "/v1/policy/role-features/evaluate?roles=finance_clerk,hr_admin",
      headers: authHeader(["super_admin"]),
    });
    expect(res.statusCode).not.toBe(403);
    expect(res.statusCode).not.toBe(401);
  });

  it("returns 400 without roles query param", async () => {
    const res = await app.inject({
      method: "GET", url: "/v1/policy/role-features/evaluate",
      headers: authHeader(["super_admin"]),
    });
    expect(res.statusCode).toBe(400);
  });

  it("returns 403 for employee", async () => {
    const res = await app.inject({
      method: "GET", url: "/v1/policy/role-features/evaluate?roles=finance_clerk",
      headers: authHeader(["employee"]),
    });
    expect(res.statusCode).toBe(403);
  });

  it("returns 401 without token", async () => {
    const res = await app.inject({
      method: "GET", url: "/v1/policy/role-features/evaluate?roles=finance_clerk",
    });
    expect(res.statusCode).toBe(401);
  });
});
