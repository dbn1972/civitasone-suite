/**
 * admin-service — custom-domains route tests.
 * Tests register, verify, DNS instructions, delete, auth, and validation.
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
  return signToken({ sub: ACTOR, tid: tenantId, roles, sid: "sess-cd" }, SECRET, 3600);
}

function authHeader(roles?: string[], tenantId?: string) {
  return { authorization: `Bearer ${token(roles, tenantId)}` };
}

let app: FastifyInstance;

beforeAll(async () => { app = await buildApp(); });
afterAll(async () => { await app.close(); await sqlClient.end(); });

// ══════════════════════════════════════════════════════════════════════════════
// GET /v1/admin/custom-domains — LIST
// ══════════════════════════════════════════════════════════════════════════════
describe("GET /v1/admin/custom-domains", () => {
  it("does not return 403 for super_admin", async () => {
    const res = await app.inject({ method: "GET", url: "/v1/admin/custom-domains", headers: authHeader(["super_admin"]) });
    expect(res.statusCode).not.toBe(403);
    expect(res.statusCode).not.toBe(401);
  });

  it("does not return 403 for platform_admin", async () => {
    const res = await app.inject({ method: "GET", url: "/v1/admin/custom-domains", headers: authHeader(["platform_admin"]) });
    expect(res.statusCode).not.toBe(403);
    expect(res.statusCode).not.toBe(401);
  });

  it("returns 403 for tenant_admin", async () => {
    const res = await app.inject({ method: "GET", url: "/v1/admin/custom-domains", headers: authHeader(["tenant_admin"]) });
    expect(res.statusCode).toBe(403);
  });

  it("returns 401 without token", async () => {
    const res = await app.inject({ method: "GET", url: "/v1/admin/custom-domains" });
    expect(res.statusCode).toBe(401);
  });
});

// ══════════════════════════════════════════════════════════════════════════════
// POST /v1/admin/custom-domains — REGISTER
// ══════════════════════════════════════════════════════════════════════════════
describe("POST /v1/admin/custom-domains", () => {
  it("returns 202 with valid domain (dns_txt)", async () => {
    const res = await app.inject({
      method: "POST", url: "/v1/admin/custom-domains",
      headers: authHeader(["super_admin"]),
      payload: { domain: "erp.example.gov.in", verificationMethod: "dns_txt" },
    });
    expect(res.statusCode).toBe(202);
    const body = res.json();
    expect(body.id).toBeDefined();
    expect(body.status).toBe("accepted");
    expect(body.verificationToken).toBeDefined();
    expect(body.verificationToken).toContain("civitasone-verify-");
  });

  it("returns 202 with dns_cname method", async () => {
    const res = await app.inject({
      method: "POST", url: "/v1/admin/custom-domains",
      headers: authHeader(["super_admin"]),
      payload: { domain: "portal.myorg.co.in", verificationMethod: "dns_cname" },
    });
    expect(res.statusCode).toBe(202);
  });

  it("returns 202 with default verification method", async () => {
    const res = await app.inject({
      method: "POST", url: "/v1/admin/custom-domains",
      headers: authHeader(["platform_admin"]),
      payload: { domain: "app.department.nic.in" },
    });
    expect(res.statusCode).toBe(202);
  });

  it("returns 400 with invalid domain format", async () => {
    const res = await app.inject({
      method: "POST", url: "/v1/admin/custom-domains",
      headers: authHeader(["super_admin"]),
      payload: { domain: "not a domain!!" },
    });
    expect(res.statusCode).toBe(400);
  });

  it("returns 400 with domain too short", async () => {
    const res = await app.inject({
      method: "POST", url: "/v1/admin/custom-domains",
      headers: authHeader(["super_admin"]),
      payload: { domain: "a.b" },
    });
    expect(res.statusCode).toBe(400);
  });

  it("returns 400 with missing domain", async () => {
    const res = await app.inject({
      method: "POST", url: "/v1/admin/custom-domains",
      headers: authHeader(["super_admin"]),
      payload: {},
    });
    expect(res.statusCode).toBe(400);
  });

  it("returns 403 for tenant_admin", async () => {
    const res = await app.inject({
      method: "POST", url: "/v1/admin/custom-domains",
      headers: authHeader(["tenant_admin"]),
      payload: { domain: "erp.test.gov.in" },
    });
    expect(res.statusCode).toBe(403);
  });

  it("returns 403 for employee", async () => {
    const res = await app.inject({
      method: "POST", url: "/v1/admin/custom-domains",
      headers: authHeader(["employee"]),
      payload: { domain: "erp.test.gov.in" },
    });
    expect(res.statusCode).toBe(403);
  });
});

// ══════════════════════════════════════════════════════════════════════════════
// POST /v1/admin/custom-domains/:id/verify — VERIFY
// ══════════════════════════════════════════════════════════════════════════════
describe("POST /v1/admin/custom-domains/:id/verify", () => {
  it("returns 202 for super_admin", async () => {
    const res = await app.inject({
      method: "POST", url: `/v1/admin/custom-domains/${VALID_UUID}/verify`,
      headers: authHeader(["super_admin"]),
    });
    expect(res.statusCode).toBe(202);
    expect(res.json().status).toBe("accepted");
  });

  it("returns 400 with invalid uuid", async () => {
    const res = await app.inject({
      method: "POST", url: "/v1/admin/custom-domains/bad-id/verify",
      headers: authHeader(["super_admin"]),
    });
    expect(res.statusCode).toBe(400);
  });

  it("returns 403 for tenant_admin", async () => {
    const res = await app.inject({
      method: "POST", url: `/v1/admin/custom-domains/${VALID_UUID}/verify`,
      headers: authHeader(["tenant_admin"]),
    });
    expect(res.statusCode).toBe(403);
  });
});

// ══════════════════════════════════════════════════════════════════════════════
// DELETE /v1/admin/custom-domains/:id
// ══════════════════════════════════════════════════════════════════════════════
describe("DELETE /v1/admin/custom-domains/:id", () => {
  it("returns 202 for super_admin", async () => {
    const res = await app.inject({
      method: "DELETE", url: `/v1/admin/custom-domains/${VALID_UUID}`,
      headers: authHeader(["super_admin"]),
    });
    expect(res.statusCode).toBe(202);
  });

  it("returns 400 with invalid uuid", async () => {
    const res = await app.inject({
      method: "DELETE", url: "/v1/admin/custom-domains/not-uuid",
      headers: authHeader(["super_admin"]),
    });
    expect(res.statusCode).toBe(400);
  });

  it("returns 403 for employee", async () => {
    const res = await app.inject({
      method: "DELETE", url: `/v1/admin/custom-domains/${VALID_UUID}`,
      headers: authHeader(["employee"]),
    });
    expect(res.statusCode).toBe(403);
  });
});

// ══════════════════════════════════════════════════════════════════════════════
// GET /v1/admin/custom-domains/:id/dns-instructions
// ══════════════════════════════════════════════════════════════════════════════
describe("GET /v1/admin/custom-domains/:id/dns-instructions", () => {
  it("does not return 403 for super_admin", async () => {
    const res = await app.inject({
      method: "GET", url: `/v1/admin/custom-domains/${VALID_UUID}/dns-instructions`,
      headers: authHeader(["super_admin"]),
    });
    // Will be 404 (no row) or 500 (schema) but NOT auth failure
    expect(res.statusCode).not.toBe(403);
    expect(res.statusCode).not.toBe(401);
  });

  it("returns 400 with invalid uuid", async () => {
    const res = await app.inject({
      method: "GET", url: "/v1/admin/custom-domains/bad/dns-instructions",
      headers: authHeader(["super_admin"]),
    });
    expect(res.statusCode).toBe(400);
  });

  it("returns 403 for tenant_admin", async () => {
    const res = await app.inject({
      method: "GET", url: `/v1/admin/custom-domains/${VALID_UUID}/dns-instructions`,
      headers: authHeader(["tenant_admin"]),
    });
    expect(res.statusCode).toBe(403);
  });

  it("returns 401 without token", async () => {
    const res = await app.inject({
      method: "GET", url: `/v1/admin/custom-domains/${VALID_UUID}/dns-instructions`,
    });
    expect(res.statusCode).toBe(401);
  });
});
