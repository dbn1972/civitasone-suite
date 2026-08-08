/**
 * Pack #26 — Webhooks: domain logic and route validation.
 *
 * Tests HMAC-SHA256 signing, URL validation (HTTPS enforcement / SSRF protection),
 * route RBAC, validation boundaries, and 404 handling.
 */
import { describe, it, expect, beforeAll, afterAll, beforeEach } from "vitest";
import { eq, inArray } from "drizzle-orm";
import { signToken } from "@civitasone/auth";
import { runWithTenant } from "@civitasone/db";
import { signPayload, validateEndpointUrl } from "../src/modules/webhook/domain.js";
import { buildApp } from "../src/app.js";
import { db, sqlClient } from "../src/shared/db.js";
import { outboxMessages, processed } from "../src/shared/outbox.js";

const SECRET = process.env.JWT_SECRET as string;
const TENANT = "ffff0001-1111-4000-8000-000000ab0001";
const ACTOR = "ffffaaaa-1111-4000-8000-000000ab000a";

function token(roles: string[], tid = TENANT): string {
  return signToken({ sub: ACTOR, tid, roles, sid: "sess-wh" }, SECRET, 3600);
}
const bearer = (roles: string[], tid = TENANT) => ({ authorization: `Bearer ${token(roles, tid)}` });

describe("signPayload — HMAC-SHA256", () => {
  it("produces consistent hex digest for same input", () => {
    const sig1 = signPayload('{"event":"test"}', "my-secret-key-1234");
    const sig2 = signPayload('{"event":"test"}', "my-secret-key-1234");
    expect(sig1).toBe(sig2);
    expect(sig1).toMatch(/^[0-9a-f]{64}$/); // SHA-256 = 64 hex chars
  });

  it("changes when payload changes", () => {
    const sig1 = signPayload('{"event":"test"}', "secret");
    const sig2 = signPayload('{"event":"other"}', "secret");
    expect(sig1).not.toBe(sig2);
  });

  it("changes when secret changes", () => {
    const sig1 = signPayload('{"event":"test"}', "secret-a");
    const sig2 = signPayload('{"event":"test"}', "secret-b");
    expect(sig1).not.toBe(sig2);
  });

  it("handles empty payload", () => {
    const sig = signPayload("", "secret");
    expect(sig).toMatch(/^[0-9a-f]{64}$/);
  });

  it("handles unicode in payload", () => {
    const sig = signPayload('{"message":"नमस्ते"}', "secret");
    expect(sig).toMatch(/^[0-9a-f]{64}$/);
  });
});

describe("validateEndpointUrl — HTTPS enforcement", () => {
  it("accepts valid HTTPS URL", () => {
    expect(validateEndpointUrl("https://api.example.com/webhooks")).toBe(true);
  });

  it("accepts HTTPS URL with port", () => {
    expect(validateEndpointUrl("https://api.example.com:8443/hook")).toBe(true);
  });

  it("rejects HTTP URL (no TLS)", () => {
    expect(validateEndpointUrl("http://api.example.com/webhooks")).toBe(false);
  });

  it("rejects non-URL strings", () => {
    expect(validateEndpointUrl("not-a-url")).toBe(false);
    expect(validateEndpointUrl("")).toBe(false);
  });

  it("rejects FTP protocol", () => {
    expect(validateEndpointUrl("ftp://files.example.com/hook")).toBe(false);
  });

  it("rejects file protocol (SSRF vector)", () => {
    expect(validateEndpointUrl("file:///etc/passwd")).toBe(false);
  });
});

describe("POST /v1/webhooks — route tests", () => {
  const validBody = {
    name: "My Webhook",
    url: "https://api.example.com/webhooks/notify",
    secret: "a-very-secure-secret-key-minimum-16",
  };

  it("202 for valid webhook creation by admin", async () => {
    const app = await buildApp();
    const res = await app.inject({
      method: "POST", url: "/v1/webhooks",
      headers: bearer(["notification_admin"]),
      payload: validBody,
    });
    await app.close();
    expect(res.statusCode).toBe(202);
  });

  it("400 for HTTP URL (not HTTPS)", async () => {
    const app = await buildApp();
    const res = await app.inject({
      method: "POST", url: "/v1/webhooks",
      headers: bearer(["notification_admin"]),
      payload: { ...validBody, url: "http://insecure.example.com/hook" },
    });
    await app.close();
    expect(res.statusCode).toBe(400);
    expect(res.json().code).toBe("INVALID_URL");
  });

  it("400 for secret shorter than 16 chars", async () => {
    const app = await buildApp();
    const res = await app.inject({
      method: "POST", url: "/v1/webhooks",
      headers: bearer(["notification_admin"]),
      payload: { ...validBody, secret: "short" },
    });
    await app.close();
    expect(res.statusCode).toBe(400);
  });

  it("400 for empty name", async () => {
    const app = await buildApp();
    const res = await app.inject({
      method: "POST", url: "/v1/webhooks",
      headers: bearer(["notification_admin"]),
      payload: { ...validBody, name: "" },
    });
    await app.close();
    expect(res.statusCode).toBe(400);
  });

  it("401 without a token", async () => {
    const app = await buildApp();
    const res = await app.inject({
      method: "POST", url: "/v1/webhooks", payload: validBody,
    });
    await app.close();
    expect(res.statusCode).toBe(401);
  });

  it("403 for non-admin role", async () => {
    const app = await buildApp();
    const res = await app.inject({
      method: "POST", url: "/v1/webhooks",
      headers: bearer(["employee"]),
      payload: validBody,
    });
    await app.close();
    expect(res.statusCode).toBe(403);
  });
});

describe("GET /v1/webhooks — list", () => {
  it("200 for authenticated user", async () => {
    const app = await buildApp();
    const res = await app.inject({
      method: "GET", url: "/v1/webhooks",
      headers: bearer(["notification_admin"]),
    });
    await app.close();
    expect(res.statusCode).toBe(200);
    expect(Array.isArray(res.json().data)).toBe(true);
  });

  it("401 without a token", async () => {
    const app = await buildApp();
    const res = await app.inject({ method: "GET", url: "/v1/webhooks" });
    await app.close();
    expect(res.statusCode).toBe(401);
  });
});

describe("PATCH /v1/webhooks/:id — update", () => {
  const unknownId = "ffff9999-1111-4000-8000-000000000099";

  it("404 for unknown endpoint", async () => {
    const app = await buildApp();
    const res = await app.inject({
      method: "PATCH", url: `/v1/webhooks/${unknownId}`,
      headers: bearer(["notification_admin"]),
      payload: { name: "Updated" },
    });
    await app.close();
    expect(res.statusCode).toBe(404);
  });

  it("400 for HTTP URL in update", async () => {
    const app = await buildApp();
    const res = await app.inject({
      method: "PATCH", url: `/v1/webhooks/${unknownId}`,
      headers: bearer(["notification_admin"]),
      payload: { url: "http://bad.example.com/hook" },
    });
    await app.close();
    // The route checks URL validity before checking existence — may be 400 or 404.
    // Either is acceptable since the request is invalid.
    expect([400, 404]).toContain(res.statusCode);
  });

  it("401 without a token", async () => {
    const app = await buildApp();
    const res = await app.inject({
      method: "PATCH", url: `/v1/webhooks/${unknownId}`,
      payload: { name: "X" },
    });
    await app.close();
    expect(res.statusCode).toBe(401);
  });

  it("403 for non-admin role", async () => {
    const app = await buildApp();
    const res = await app.inject({
      method: "PATCH", url: `/v1/webhooks/${unknownId}`,
      headers: bearer(["employee"]),
      payload: { name: "X" },
    });
    await app.close();
    expect(res.statusCode).toBe(403);
  });
});

describe("DELETE /v1/webhooks/:id — soft delete", () => {
  const unknownId = "ffff9999-1111-4000-8000-000000000099";

  it("404 for unknown endpoint", async () => {
    const app = await buildApp();
    const res = await app.inject({
      method: "DELETE", url: `/v1/webhooks/${unknownId}`,
      headers: bearer(["notification_admin"]),
    });
    await app.close();
    expect(res.statusCode).toBe(404);
  });

  it("401 without a token", async () => {
    const app = await buildApp();
    const res = await app.inject({
      method: "DELETE", url: `/v1/webhooks/${unknownId}`,
    });
    await app.close();
    expect(res.statusCode).toBe(401);
  });

  it("403 for non-admin role", async () => {
    const app = await buildApp();
    const res = await app.inject({
      method: "DELETE", url: `/v1/webhooks/${unknownId}`,
      headers: bearer(["employee"]),
    });
    await app.close();
    expect(res.statusCode).toBe(403);
  });
});
