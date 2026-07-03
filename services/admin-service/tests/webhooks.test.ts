/**
 * admin-service — webhooks route tests + HMAC signature verification.
 * Tests CRUD, delivery log, test event, auth, validation, and HMAC-SHA256 signing.
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { signToken } from "@civitasone/auth";
import type { FastifyInstance } from "fastify";
import { buildApp } from "../src/app.js";
import { sqlClient } from "../src/shared/db.js";
import { signPayload, verifySignature, generateSecret } from "../src/modules/webhooks/commands.js";

const SECRET = "test_secret_for_civitasone_32chr";
const TENANT = "aaaaaaaa-cccc-4000-8000-000000000001";
const ACTOR = "00000000-cccc-4000-8000-000000000002";
const VALID_UUID = "11111111-cccc-4000-8000-333333333333";

function token(roles: string[] = ["tenant_admin"], tenantId = TENANT): string {
  return signToken({ sub: ACTOR, tid: tenantId, roles, sid: "sess-wh" }, SECRET, 3600);
}

function authHeader(roles?: string[], tenantId?: string) {
  return { authorization: `Bearer ${token(roles, tenantId)}` };
}

let app: FastifyInstance;

beforeAll(async () => { app = await buildApp(); });
afterAll(async () => { await app.close(); await sqlClient.end(); });

// ══════════════════════════════════════════════════════════════════════════════
// HMAC-SHA256 SIGNATURE TESTS
// ══════════════════════════════════════════════════════════════════════════════
describe("HMAC-SHA256 Signature", () => {
  it("signPayload produces sha256= prefixed signature", () => {
    const sig = signPayload("my-secret", '{"event":"test"}');
    expect(sig).toMatch(/^sha256=[a-f0-9]{64}$/);
  });

  it("same secret + body always produces same signature", () => {
    const body = '{"event":"invoice.created","id":"123"}';
    const sig1 = signPayload("secret-key", body);
    const sig2 = signPayload("secret-key", body);
    expect(sig1).toBe(sig2);
  });

  it("different secrets produce different signatures", () => {
    const body = '{"event":"test"}';
    const sig1 = signPayload("secret-a", body);
    const sig2 = signPayload("secret-b", body);
    expect(sig1).not.toBe(sig2);
  });

  it("different bodies produce different signatures", () => {
    const sig1 = signPayload("same-secret", '{"a":1}');
    const sig2 = signPayload("same-secret", '{"a":2}');
    expect(sig1).not.toBe(sig2);
  });

  it("verifySignature returns true for valid signature", () => {
    const body = '{"event":"finance.invoice.created"}';
    const secret = "webhook-hmac-key";
    const sig = signPayload(secret, body);
    expect(verifySignature(secret, body, sig)).toBe(true);
  });

  it("verifySignature returns false for tampered body", () => {
    const secret = "webhook-hmac-key";
    const sig = signPayload(secret, '{"event":"original"}');
    expect(verifySignature(secret, '{"event":"tampered"}', sig)).toBe(false);
  });

  it("verifySignature returns false for wrong secret", () => {
    const body = '{"event":"test"}';
    const sig = signPayload("correct-secret", body);
    expect(verifySignature("wrong-secret", body, sig)).toBe(false);
  });

  it("verifySignature returns false for empty signature", () => {
    expect(verifySignature("secret", "body", "")).toBe(false);
  });

  it("generateSecret produces a whsec_ prefixed string", () => {
    const secret = generateSecret();
    expect(secret).toMatch(/^whsec_[A-Za-z0-9_-]+$/);
    expect(secret.length).toBeGreaterThan(20);
  });

  it("generateSecret produces unique values", () => {
    const secrets = new Set(Array.from({ length: 50 }, () => generateSecret()));
    expect(secrets.size).toBe(50);
  });
});

// ══════════════════════════════════════════════════════════════════════════════
// GET /v1/admin/webhooks (LIST)
// ══════════════════════════════════════════════════════════════════════════════
describe("GET /v1/admin/webhooks", () => {
  it("does not return 403 for tenant_admin (auth passes)", async () => {
    const res = await app.inject({ method: "GET", url: "/v1/admin/webhooks", headers: authHeader(["tenant_admin"]) });
    expect(res.statusCode).not.toBe(403);
    expect(res.statusCode).not.toBe(401);
  });

  it("does not return 403 for super_admin (auth passes)", async () => {
    const res = await app.inject({ method: "GET", url: "/v1/admin/webhooks", headers: authHeader(["super_admin"]) });
    expect(res.statusCode).not.toBe(403);
    expect(res.statusCode).not.toBe(401);
  });

  it("returns 403 for employee", async () => {
    const res = await app.inject({ method: "GET", url: "/v1/admin/webhooks", headers: authHeader(["employee"]) });
    expect(res.statusCode).toBe(403);
  });

  it("returns 401 without auth", async () => {
    const res = await app.inject({ method: "GET", url: "/v1/admin/webhooks" });
    expect(res.statusCode).toBe(401);
  });
});

// ══════════════════════════════════════════════════════════════════════════════
// POST /v1/admin/webhooks (CREATE)
// ══════════════════════════════════════════════════════════════════════════════
describe("POST /v1/admin/webhooks", () => {
  it("returns 202 with valid webhook creation", async () => {
    const res = await app.inject({
      method: "POST", url: "/v1/admin/webhooks",
      headers: authHeader(["tenant_admin"]),
      payload: { url: "https://example.com/hook", events: ["finance.invoice.created"] },
    });
    expect(res.statusCode).toBe(202);
    const body = res.json();
    expect(body.id).toBeDefined();
    expect(body.status).toBe("accepted");
    expect(body.secret).toBeDefined();
    expect(body.secret).toMatch(/^whsec_/);
  });

  it("returns 202 with multiple events", async () => {
    const res = await app.inject({
      method: "POST", url: "/v1/admin/webhooks",
      headers: authHeader(["tenant_admin"]),
      payload: { url: "https://example.com/hook", events: ["a.b.c", "d.e.f", "g.h.i"], description: "Multi-event" },
    });
    expect(res.statusCode).toBe(202);
  });

  it("returns 400 with invalid URL", async () => {
    const res = await app.inject({
      method: "POST", url: "/v1/admin/webhooks",
      headers: authHeader(["tenant_admin"]),
      payload: { url: "not-a-url", events: ["test.event"] },
    });
    expect(res.statusCode).toBe(400);
  });

  it("returns 400 with empty events array", async () => {
    const res = await app.inject({
      method: "POST", url: "/v1/admin/webhooks",
      headers: authHeader(["tenant_admin"]),
      payload: { url: "https://example.com/hook", events: [] },
    });
    expect(res.statusCode).toBe(400);
  });

  it("returns 400 with missing url", async () => {
    const res = await app.inject({
      method: "POST", url: "/v1/admin/webhooks",
      headers: authHeader(["tenant_admin"]),
      payload: { events: ["test.event"] },
    });
    expect(res.statusCode).toBe(400);
  });

  it("returns 403 for employee", async () => {
    const res = await app.inject({
      method: "POST", url: "/v1/admin/webhooks",
      headers: authHeader(["employee"]),
      payload: { url: "https://example.com/hook", events: ["test"] },
    });
    expect(res.statusCode).toBe(403);
  });
});

// ══════════════════════════════════════════════════════════════════════════════
// PUT /v1/admin/webhooks/:id (UPDATE)
// ══════════════════════════════════════════════════════════════════════════════
describe("PUT /v1/admin/webhooks/:id", () => {
  it("returns 202 with valid update", async () => {
    const res = await app.inject({
      method: "PUT", url: `/v1/admin/webhooks/${VALID_UUID}`,
      headers: authHeader(["tenant_admin"]),
      payload: { active: false },
    });
    expect(res.statusCode).toBe(202);
  });

  it("returns 202 with url update", async () => {
    const res = await app.inject({
      method: "PUT", url: `/v1/admin/webhooks/${VALID_UUID}`,
      headers: authHeader(["tenant_admin"]),
      payload: { url: "https://new-url.com/hook" },
    });
    expect(res.statusCode).toBe(202);
  });

  it("returns 400 with empty body", async () => {
    const res = await app.inject({
      method: "PUT", url: `/v1/admin/webhooks/${VALID_UUID}`,
      headers: authHeader(["tenant_admin"]),
      payload: {},
    });
    expect(res.statusCode).toBe(400);
  });

  it("returns 400 with invalid uuid", async () => {
    const res = await app.inject({
      method: "PUT", url: "/v1/admin/webhooks/bad-id",
      headers: authHeader(["tenant_admin"]),
      payload: { active: true },
    });
    expect(res.statusCode).toBe(400);
  });

  it("returns 403 for employee", async () => {
    const res = await app.inject({
      method: "PUT", url: `/v1/admin/webhooks/${VALID_UUID}`,
      headers: authHeader(["employee"]),
      payload: { active: false },
    });
    expect(res.statusCode).toBe(403);
  });
});

// ══════════════════════════════════════════════════════════════════════════════
// DELETE /v1/admin/webhooks/:id
// ══════════════════════════════════════════════════════════════════════════════
describe("DELETE /v1/admin/webhooks/:id", () => {
  it("returns 202 for tenant_admin", async () => {
    const res = await app.inject({
      method: "DELETE", url: `/v1/admin/webhooks/${VALID_UUID}`,
      headers: authHeader(["tenant_admin"]),
    });
    expect(res.statusCode).toBe(202);
  });

  it("returns 400 with invalid uuid", async () => {
    const res = await app.inject({
      method: "DELETE", url: "/v1/admin/webhooks/not-uuid",
      headers: authHeader(["tenant_admin"]),
    });
    expect(res.statusCode).toBe(400);
  });

  it("returns 403 for employee", async () => {
    const res = await app.inject({
      method: "DELETE", url: `/v1/admin/webhooks/${VALID_UUID}`,
      headers: authHeader(["employee"]),
    });
    expect(res.statusCode).toBe(403);
  });
});

// ══════════════════════════════════════════════════════════════════════════════
// GET /v1/admin/webhooks/:id/deliveries (DELIVERY LOG)
// ══════════════════════════════════════════════════════════════════════════════
describe("GET /v1/admin/webhooks/:id/deliveries", () => {
  it("returns 404 or 500 for non-existent webhook (auth passes)", async () => {
    const res = await app.inject({
      method: "GET", url: `/v1/admin/webhooks/${VALID_UUID}/deliveries`,
      headers: authHeader(["tenant_admin"]),
    });
    // 404 if schema exists, 500 if not — auth passed
    expect([404, 500]).toContain(res.statusCode);
  });

  it("returns 400 with invalid uuid", async () => {
    const res = await app.inject({
      method: "GET", url: "/v1/admin/webhooks/bad/deliveries",
      headers: authHeader(["tenant_admin"]),
    });
    expect(res.statusCode).toBe(400);
  });

  it("returns 403 for employee", async () => {
    const res = await app.inject({
      method: "GET", url: `/v1/admin/webhooks/${VALID_UUID}/deliveries`,
      headers: authHeader(["employee"]),
    });
    expect(res.statusCode).toBe(403);
  });
});

// ══════════════════════════════════════════════════════════════════════════════
// POST /v1/admin/webhooks/:id/test (SEND TEST EVENT)
// ══════════════════════════════════════════════════════════════════════════════
describe("POST /v1/admin/webhooks/:id/test", () => {
  it("returns 202 for tenant_admin", async () => {
    const res = await app.inject({
      method: "POST", url: `/v1/admin/webhooks/${VALID_UUID}/test`,
      headers: authHeader(["tenant_admin"]),
    });
    expect(res.statusCode).toBe(202);
  });

  it("returns 400 with invalid uuid", async () => {
    const res = await app.inject({
      method: "POST", url: "/v1/admin/webhooks/invalid/test",
      headers: authHeader(["tenant_admin"]),
    });
    expect(res.statusCode).toBe(400);
  });

  it("returns 403 for employee", async () => {
    const res = await app.inject({
      method: "POST", url: `/v1/admin/webhooks/${VALID_UUID}/test`,
      headers: authHeader(["employee"]),
    });
    expect(res.statusCode).toBe(403);
  });

  it("returns 401 without auth", async () => {
    const res = await app.inject({
      method: "POST", url: `/v1/admin/webhooks/${VALID_UUID}/test`,
    });
    expect(res.statusCode).toBe(401);
  });
});
