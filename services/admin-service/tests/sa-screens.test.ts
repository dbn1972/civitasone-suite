/**
 * admin-service — SA screen backend route tests.
 * Tests the endpoints that back all 14 Admin/SA UI screens:
 * tenants, health, operations, feature-flags (covered separately).
 * Covers: auth (401/403), happy path, and validation.
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { signToken } from "@civitasone/auth";
import type { FastifyInstance } from "fastify";
import { buildApp } from "../src/app.js";
import { sqlClient } from "../src/shared/db.js";

const SECRET = "test_secret_for_civitasone_32chr";
const TENANT = "aaaaaaaa-cccc-4000-8000-000000000001";
const ACTOR = "00000000-cccc-4000-8000-000000000002";

function token(roles: string[] = ["super_admin"]): string {
  return signToken({ sub: ACTOR, tid: TENANT, roles, sid: "sess-sa" }, SECRET, 3600);
}

function authHeader(roles?: string[]) {
  return { authorization: `Bearer ${token(roles)}` };
}

let app: FastifyInstance;

beforeAll(async () => { app = await buildApp(); });
afterAll(async () => { await app.close(); await sqlClient.end(); });

// ══════════════════════════════════════════════════════════════════════════════
// GET /v1/admin/tenants — SA Tenants List
// ══════════════════════════════════════════════════════════════════════════════
describe("GET /v1/admin/tenants", () => {
  it("returns 200 or passes auth for super_admin", async () => {
    const res = await app.inject({ method: "GET", url: "/v1/admin/tenants", headers: authHeader(["super_admin"]) });
    expect(res.statusCode).not.toBe(401);
    expect(res.statusCode).not.toBe(403);
  });

  it("returns 403 for tenant_admin (not super_admin)", async () => {
    const res = await app.inject({ method: "GET", url: "/v1/admin/tenants", headers: authHeader(["tenant_admin"]) });
    expect(res.statusCode).toBe(403);
  });

  it("returns 401 without auth", async () => {
    const res = await app.inject({ method: "GET", url: "/v1/admin/tenants" });
    expect(res.statusCode).toBe(401);
  });
});

// ══════════════════════════════════════════════════════════════════════════════
// POST /v1/admin/tenants — Create Tenant (Provisioning)
// ══════════════════════════════════════════════════════════════════════════════
describe("POST /v1/admin/tenants", () => {
  it("returns 202 with valid body for super_admin", async () => {
    const res = await app.inject({
      method: "POST", url: "/v1/admin/tenants",
      headers: authHeader(["super_admin"]),
      payload: { name: "Test Org", domain: "test-org.civitasone.in", edition: "govt_dept", region: "ap-south-1", residency: "india" },
    });
    expect(res.statusCode).toBe(202);
  });

  it("returns 400 with missing required fields", async () => {
    const res = await app.inject({
      method: "POST", url: "/v1/admin/tenants",
      headers: authHeader(["super_admin"]),
      payload: { name: "Incomplete" },
    });
    expect(res.statusCode).toBe(400);
  });

  it("returns 400 with invalid edition enum", async () => {
    const res = await app.inject({
      method: "POST", url: "/v1/admin/tenants",
      headers: authHeader(["super_admin"]),
      payload: { name: "Bad Edition", domain: "bad.civitasone.in", edition: "invalid_type", region: "us-west", residency: "india" },
    });
    expect(res.statusCode).toBe(400);
  });

  it("returns 403 for employee", async () => {
    const res = await app.inject({
      method: "POST", url: "/v1/admin/tenants",
      headers: authHeader(["employee"]),
      payload: { name: "Blocked Org", domain: "blocked.civitasone.in", edition: "small_office", region: "ap-south-1", residency: "india" },
    });
    expect(res.statusCode).toBe(403);
  });
});

// ══════════════════════════════════════════════════════════════════════════════
// GET /v1/admin/health — Platform Health (SA Dashboard backing)
// ══════════════════════════════════════════════════════════════════════════════
describe("GET /v1/admin/health", () => {
  it("passes auth for tenant_admin (health is wider access)", async () => {
    const res = await app.inject({ method: "GET", url: "/v1/admin/health", headers: authHeader(["tenant_admin"]) });
    expect(res.statusCode).not.toBe(401);
    expect(res.statusCode).not.toBe(403);
  });

  it("passes auth for super_admin", async () => {
    const res = await app.inject({ method: "GET", url: "/v1/admin/health", headers: authHeader(["super_admin"]) });
    expect(res.statusCode).not.toBe(401);
    expect(res.statusCode).not.toBe(403);
  });

  it("returns 401 without auth", async () => {
    const res = await app.inject({ method: "GET", url: "/v1/admin/health" });
    expect(res.statusCode).toBe(401);
  });

  it("returns 403 for employee", async () => {
    const res = await app.inject({ method: "GET", url: "/v1/admin/health", headers: authHeader(["employee"]) });
    expect(res.statusCode).toBe(403);
  });
});

// ══════════════════════════════════════════════════════════════════════════════
// GET /v1/admin/operations — Operations Dashboard (SA only)
// ══════════════════════════════════════════════════════════════════════════════
describe("GET /v1/admin/operations", () => {
  it("passes auth for super_admin", async () => {
    const res = await app.inject({ method: "GET", url: "/v1/admin/operations", headers: authHeader(["super_admin"]) });
    expect(res.statusCode).not.toBe(401);
    expect(res.statusCode).not.toBe(403);
  });

  it("returns 403 for tenant_admin", async () => {
    const res = await app.inject({ method: "GET", url: "/v1/admin/operations", headers: authHeader(["tenant_admin"]) });
    expect(res.statusCode).toBe(403);
  });

  it("returns 401 without auth", async () => {
    const res = await app.inject({ method: "GET", url: "/v1/admin/operations" });
    expect(res.statusCode).toBe(401);
  });
});

// ══════════════════════════════════════════════════════════════════════════════
// GET /v1/admin/health/readiness — Tech Admin backing
// ══════════════════════════════════════════════════════════════════════════════
describe("GET /v1/admin/health/readiness", () => {
  it("passes auth for super_admin", async () => {
    const res = await app.inject({ method: "GET", url: "/v1/admin/health/readiness", headers: authHeader(["super_admin"]) });
    expect(res.statusCode).not.toBe(401);
    expect(res.statusCode).not.toBe(403);
  });

  it("returns 403 for tenant_admin (SA only)", async () => {
    const res = await app.inject({ method: "GET", url: "/v1/admin/health/readiness", headers: authHeader(["tenant_admin"]) });
    expect(res.statusCode).toBe(403);
  });
});

// ══════════════════════════════════════════════════════════════════════════════
// GET /v1/admin/health/:service — Per-service health (API Monitoring backing)
// ══════════════════════════════════════════════════════════════════════════════
describe("GET /v1/admin/health/:service", () => {
  it("passes auth for super_admin", async () => {
    const res = await app.inject({ method: "GET", url: "/v1/admin/health/identity-service", headers: authHeader(["super_admin"]) });
    // Might be 200 or 404 (service not found) — either means auth passed
    expect(res.statusCode).not.toBe(401);
    expect(res.statusCode).not.toBe(403);
  });

  it("returns 403 for tenant_admin", async () => {
    const res = await app.inject({ method: "GET", url: "/v1/admin/health/identity-service", headers: authHeader(["tenant_admin"]) });
    expect(res.statusCode).toBe(403);
  });
});

// ══════════════════════════════════════════════════════════════════════════════
// PATCH /v1/admin/tenants/:id/suspend — Tenant lifecycle
// ══════════════════════════════════════════════════════════════════════════════
describe("PATCH /v1/admin/tenants/:id/suspend", () => {
  const id = "11111111-cccc-4000-8000-aaaaaaaaaaaa";

  it("returns 202 for super_admin", async () => {
    const res = await app.inject({
      method: "PATCH", url: `/v1/admin/tenants/${id}/suspend`,
      headers: authHeader(["super_admin"]),
      payload: { reason: "Non-payment" },
    });
    expect(res.statusCode).toBe(202);
  });

  it("returns 403 for employee", async () => {
    const res = await app.inject({
      method: "PATCH", url: `/v1/admin/tenants/${id}/suspend`,
      headers: authHeader(["employee"]),
      payload: { reason: "test" },
    });
    expect(res.statusCode).toBe(403);
  });
});

// ══════════════════════════════════════════════════════════════════════════════
// GET /v1/admin/queue-metrics — Queue overview
// ══════════════════════════════════════════════════════════════════════════════
describe("GET /v1/admin/queue-metrics", () => {
  it("returns 200 for tenant_admin", async () => {
    const res = await app.inject({ method: "GET", url: "/v1/admin/queue-metrics", headers: authHeader(["tenant_admin"]) });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.driver).toBeDefined();
  });

  it("returns 403 for employee", async () => {
    const res = await app.inject({ method: "GET", url: "/v1/admin/queue-metrics", headers: authHeader(["employee"]) });
    expect(res.statusCode).toBe(403);
  });
});
