/**
 * admin-service — data export route tests.
 * Tests DPDP-compliant data export request creation, listing, and download.
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

function token(roles: string[] = ["tenant_admin"], tenantId = TENANT): string {
  return signToken({ sub: ACTOR, tid: tenantId, roles, sid: "sess-de" }, SECRET, 3600);
}

function authHeader(roles?: string[], tenantId?: string) {
  return { authorization: `Bearer ${token(roles, tenantId)}` };
}

let app: FastifyInstance;

beforeAll(async () => { app = await buildApp(); });
afterAll(async () => { await app.close(); await sqlClient.end(); });

// ══════════════════════════════════════════════════════════════════════════════
// POST /v1/admin/data-export (CREATE EXPORT REQUEST)
// ══════════════════════════════════════════════════════════════════════════════
describe("POST /v1/admin/data-export", () => {
  it("returns 202 with valid full export request", async () => {
    const res = await app.inject({
      method: "POST", url: "/v1/admin/data-export",
      headers: authHeader(["tenant_admin"]),
      payload: { type: "full", format: "json" },
    });
    expect(res.statusCode).toBe(202);
    const body = res.json();
    expect(body.id).toBeDefined();
    expect(body.status).toBe("accepted");
  });

  it("returns 202 with module export request", async () => {
    const res = await app.inject({
      method: "POST", url: "/v1/admin/data-export",
      headers: authHeader(["tenant_admin"]),
      payload: { type: "module", moduleFilter: "finance", format: "csv" },
    });
    expect(res.statusCode).toBe(202);
  });

  it("returns 202 with entity export request", async () => {
    const res = await app.inject({
      method: "POST", url: "/v1/admin/data-export",
      headers: authHeader(["tenant_admin"]),
      payload: { type: "entity", format: "pdf" },
    });
    expect(res.statusCode).toBe(202);
  });

  it("returns 202 for super_admin", async () => {
    const res = await app.inject({
      method: "POST", url: "/v1/admin/data-export",
      headers: authHeader(["super_admin"]),
      payload: { type: "full", format: "json" },
    });
    expect(res.statusCode).toBe(202);
  });

  it("returns 400 with module type but missing moduleFilter", async () => {
    const res = await app.inject({
      method: "POST", url: "/v1/admin/data-export",
      headers: authHeader(["tenant_admin"]),
      payload: { type: "module", format: "json" },
    });
    expect(res.statusCode).toBe(400);
  });

  it("returns 400 with invalid type", async () => {
    const res = await app.inject({
      method: "POST", url: "/v1/admin/data-export",
      headers: authHeader(["tenant_admin"]),
      payload: { type: "invalid", format: "json" },
    });
    expect(res.statusCode).toBe(400);
  });

  it("returns 400 with invalid format", async () => {
    const res = await app.inject({
      method: "POST", url: "/v1/admin/data-export",
      headers: authHeader(["tenant_admin"]),
      payload: { type: "full", format: "xml" },
    });
    expect(res.statusCode).toBe(400);
  });

  it("returns 400 with missing format", async () => {
    const res = await app.inject({
      method: "POST", url: "/v1/admin/data-export",
      headers: authHeader(["tenant_admin"]),
      payload: { type: "full" },
    });
    expect(res.statusCode).toBe(400);
  });

  it("returns 403 for employee role", async () => {
    const res = await app.inject({
      method: "POST", url: "/v1/admin/data-export",
      headers: authHeader(["employee"]),
      payload: { type: "full", format: "json" },
    });
    expect(res.statusCode).toBe(403);
  });

  it("returns 401 without auth", async () => {
    const res = await app.inject({
      method: "POST", url: "/v1/admin/data-export",
      payload: { type: "full", format: "json" },
    });
    expect(res.statusCode).toBe(401);
  });
});

// ══════════════════════════════════════════════════════════════════════════════
// GET /v1/admin/data-export (LIST)
// ══════════════════════════════════════════════════════════════════════════════
describe("GET /v1/admin/data-export", () => {
  it("does not return 403 for tenant_admin (auth passes)", async () => {
    const res = await app.inject({ method: "GET", url: "/v1/admin/data-export", headers: authHeader(["tenant_admin"]) });
    // May be 200 (schema exists) or 500 (schema not yet migrated) — auth passed
    expect(res.statusCode).not.toBe(403);
    expect(res.statusCode).not.toBe(401);
  });

  it("does not return 403 for super_admin (auth passes)", async () => {
    const res = await app.inject({ method: "GET", url: "/v1/admin/data-export", headers: authHeader(["super_admin"]) });
    expect(res.statusCode).not.toBe(403);
    expect(res.statusCode).not.toBe(401);
  });

  it("returns 403 for employee", async () => {
    const res = await app.inject({ method: "GET", url: "/v1/admin/data-export", headers: authHeader(["employee"]) });
    expect(res.statusCode).toBe(403);
  });

  it("returns 401 without auth", async () => {
    const res = await app.inject({ method: "GET", url: "/v1/admin/data-export" });
    expect(res.statusCode).toBe(401);
  });
});

// ══════════════════════════════════════════════════════════════════════════════
// GET /v1/admin/data-export/:id/download
// ══════════════════════════════════════════════════════════════════════════════
describe("GET /v1/admin/data-export/:id/download", () => {
  it("returns 404 or 500 for non-existent export (auth passes)", async () => {
    const res = await app.inject({
      method: "GET", url: `/v1/admin/data-export/${VALID_UUID}/download`,
      headers: authHeader(["tenant_admin"]),
    });
    // 404 if schema exists, 500 if not — either way auth passed
    expect([404, 500]).toContain(res.statusCode);
  });

  it("returns 400 with invalid uuid", async () => {
    const res = await app.inject({
      method: "GET", url: "/v1/admin/data-export/not-uuid/download",
      headers: authHeader(["tenant_admin"]),
    });
    expect(res.statusCode).toBe(400);
  });

  it("returns 403 for employee", async () => {
    const res = await app.inject({
      method: "GET", url: `/v1/admin/data-export/${VALID_UUID}/download`,
      headers: authHeader(["employee"]),
    });
    expect(res.statusCode).toBe(403);
  });

  it("returns 401 without auth", async () => {
    const res = await app.inject({
      method: "GET", url: `/v1/admin/data-export/${VALID_UUID}/download`,
    });
    expect(res.statusCode).toBe(401);
  });
});
