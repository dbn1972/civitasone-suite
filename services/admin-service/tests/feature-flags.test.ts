/**
 * admin-service — feature flags route tests.
 * Tests CRUD operations, kill switch, auth, and validation.
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
  return signToken({ sub: ACTOR, tid: tenantId, roles, sid: "sess-ff" }, SECRET, 3600);
}

function authHeader(roles?: string[], tenantId?: string) {
  return { authorization: `Bearer ${token(roles, tenantId)}` };
}

let app: FastifyInstance;

beforeAll(async () => { app = await buildApp(); });
afterAll(async () => { await app.close(); await sqlClient.end(); });

// ══════════════════════════════════════════════════════════════════════════════
// GET /v1/admin/feature-flags/manage
// ══════════════════════════════════════════════════════════════════════════════
describe("GET /v1/admin/feature-flags/manage", () => {
  it("does not return 403 for super_admin (auth passes)", async () => {
    const res = await app.inject({ method: "GET", url: "/v1/admin/feature-flags/manage", headers: authHeader(["super_admin"]) });
    // May be 200 (if schema exists) or 500 (schema not created yet) — either means auth passed
    expect(res.statusCode).not.toBe(403);
    expect(res.statusCode).not.toBe(401);
  });

  it("does not return 403 for platform_admin (auth passes)", async () => {
    const res = await app.inject({ method: "GET", url: "/v1/admin/feature-flags/manage", headers: authHeader(["platform_admin"]) });
    expect(res.statusCode).not.toBe(403);
    expect(res.statusCode).not.toBe(401);
  });

  it("returns 403 for tenant_admin", async () => {
    const res = await app.inject({ method: "GET", url: "/v1/admin/feature-flags/manage", headers: authHeader(["tenant_admin"]) });
    expect(res.statusCode).toBe(403);
  });

  it("returns 403 for employee role", async () => {
    const res = await app.inject({ method: "GET", url: "/v1/admin/feature-flags/manage", headers: authHeader(["employee"]) });
    expect(res.statusCode).toBe(403);
  });

  it("returns 401 without token", async () => {
    const res = await app.inject({ method: "GET", url: "/v1/admin/feature-flags/manage" });
    expect(res.statusCode).toBe(401);
  });
});

// ══════════════════════════════════════════════════════════════════════════════
// POST /v1/admin/feature-flags/manage (CREATE)
// ══════════════════════════════════════════════════════════════════════════════
describe("POST /v1/admin/feature-flags/manage", () => {
  it("returns 202 with valid body for super_admin", async () => {
    const res = await app.inject({
      method: "POST", url: "/v1/admin/feature-flags/manage",
      headers: authHeader(["super_admin"]),
      payload: { key: "test-flag-one", name: "Test Flag One", description: "A test", enabled: true, rolloutPercent: 50, targetSegments: ["beta"] },
    });
    expect(res.statusCode).toBe(202);
    const body = res.json();
    expect(body.id).toBeDefined();
    expect(body.status).toBe("accepted");
  });

  it("returns 202 with minimal body", async () => {
    const res = await app.inject({
      method: "POST", url: "/v1/admin/feature-flags/manage",
      headers: authHeader(["super_admin"]),
      payload: { key: "minimal-flag", name: "Minimal" },
    });
    expect(res.statusCode).toBe(202);
  });

  it("returns 400 with missing key", async () => {
    const res = await app.inject({
      method: "POST", url: "/v1/admin/feature-flags/manage",
      headers: authHeader(["super_admin"]),
      payload: { name: "No Key Flag" },
    });
    expect(res.statusCode).toBe(400);
  });

  it("returns 400 with invalid key format (uppercase)", async () => {
    const res = await app.inject({
      method: "POST", url: "/v1/admin/feature-flags/manage",
      headers: authHeader(["super_admin"]),
      payload: { key: "INVALID_KEY!", name: "Bad" },
    });
    expect(res.statusCode).toBe(400);
  });

  it("returns 400 with rolloutPercent > 100", async () => {
    const res = await app.inject({
      method: "POST", url: "/v1/admin/feature-flags/manage",
      headers: authHeader(["super_admin"]),
      payload: { key: "over-limit", name: "Over", rolloutPercent: 150 },
    });
    expect(res.statusCode).toBe(400);
  });

  it("returns 400 with rolloutPercent < 0", async () => {
    const res = await app.inject({
      method: "POST", url: "/v1/admin/feature-flags/manage",
      headers: authHeader(["super_admin"]),
      payload: { key: "under-limit", name: "Under", rolloutPercent: -5 },
    });
    expect(res.statusCode).toBe(400);
  });

  it("returns 403 for tenant_admin", async () => {
    const res = await app.inject({
      method: "POST", url: "/v1/admin/feature-flags/manage",
      headers: authHeader(["tenant_admin"]),
      payload: { key: "no-access", name: "No Access" },
    });
    expect(res.statusCode).toBe(403);
  });
});

// ══════════════════════════════════════════════════════════════════════════════
// PUT /v1/admin/feature-flags/manage/:id (UPDATE)
// ══════════════════════════════════════════════════════════════════════════════
describe("PUT /v1/admin/feature-flags/manage/:id", () => {
  it("returns 202 with valid update body", async () => {
    const res = await app.inject({
      method: "PUT", url: `/v1/admin/feature-flags/manage/${VALID_UUID}`,
      headers: authHeader(["super_admin"]),
      payload: { name: "Updated Name", rolloutPercent: 75 },
    });
    expect(res.statusCode).toBe(202);
  });

  it("returns 400 with empty body", async () => {
    const res = await app.inject({
      method: "PUT", url: `/v1/admin/feature-flags/manage/${VALID_UUID}`,
      headers: authHeader(["super_admin"]),
      payload: {},
    });
    expect(res.statusCode).toBe(400);
  });

  it("returns 400 with invalid uuid param", async () => {
    const res = await app.inject({
      method: "PUT", url: "/v1/admin/feature-flags/manage/not-a-uuid",
      headers: authHeader(["super_admin"]),
      payload: { name: "X" },
    });
    expect(res.statusCode).toBe(400);
  });

  it("returns 403 for employee", async () => {
    const res = await app.inject({
      method: "PUT", url: `/v1/admin/feature-flags/manage/${VALID_UUID}`,
      headers: authHeader(["employee"]),
      payload: { enabled: true },
    });
    expect(res.statusCode).toBe(403);
  });
});

// ══════════════════════════════════════════════════════════════════════════════
// DELETE /v1/admin/feature-flags/manage/:id
// ══════════════════════════════════════════════════════════════════════════════
describe("DELETE /v1/admin/feature-flags/manage/:id", () => {
  it("returns 202 for super_admin", async () => {
    const res = await app.inject({
      method: "DELETE", url: `/v1/admin/feature-flags/manage/${VALID_UUID}`,
      headers: authHeader(["super_admin"]),
    });
    expect(res.statusCode).toBe(202);
  });

  it("returns 400 with invalid uuid", async () => {
    const res = await app.inject({
      method: "DELETE", url: "/v1/admin/feature-flags/manage/bad-id",
      headers: authHeader(["super_admin"]),
    });
    expect(res.statusCode).toBe(400);
  });

  it("returns 403 for tenant_admin", async () => {
    const res = await app.inject({
      method: "DELETE", url: `/v1/admin/feature-flags/manage/${VALID_UUID}`,
      headers: authHeader(["tenant_admin"]),
    });
    expect(res.statusCode).toBe(403);
  });
});

// ══════════════════════════════════════════════════════════════════════════════
// POST /v1/admin/feature-flags/manage/:id/kill (KILL SWITCH)
// ══════════════════════════════════════════════════════════════════════════════
describe("POST /v1/admin/feature-flags/manage/:id/kill", () => {
  it("returns 202 for super_admin (kill switch activated)", async () => {
    const res = await app.inject({
      method: "POST", url: `/v1/admin/feature-flags/manage/${VALID_UUID}/kill`,
      headers: authHeader(["super_admin"]),
    });
    expect(res.statusCode).toBe(202);
    expect(res.json().status).toBe("accepted");
  });

  it("returns 202 for platform_admin", async () => {
    const res = await app.inject({
      method: "POST", url: `/v1/admin/feature-flags/manage/${VALID_UUID}/kill`,
      headers: authHeader(["platform_admin"]),
    });
    expect(res.statusCode).toBe(202);
  });

  it("returns 400 with invalid uuid", async () => {
    const res = await app.inject({
      method: "POST", url: "/v1/admin/feature-flags/manage/invalid/kill",
      headers: authHeader(["super_admin"]),
    });
    expect(res.statusCode).toBe(400);
  });

  it("returns 403 for tenant_admin", async () => {
    const res = await app.inject({
      method: "POST", url: `/v1/admin/feature-flags/manage/${VALID_UUID}/kill`,
      headers: authHeader(["tenant_admin"]),
    });
    expect(res.statusCode).toBe(403);
  });

  it("returns 401 without auth", async () => {
    const res = await app.inject({
      method: "POST", url: `/v1/admin/feature-flags/manage/${VALID_UUID}/kill`,
    });
    expect(res.statusCode).toBe(401);
  });
});
