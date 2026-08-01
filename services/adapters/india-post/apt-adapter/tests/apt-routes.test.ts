/**
 * Route-level tests for apt-adapter (India Post APT integration).
 * Covers serviceability, tracking, and booking routes.
 * Tests: happy path (200/202), validation (400), unauthenticated (401), forbidden (403).
 */
import { describe, it, expect } from "vitest";
import { signToken } from "@civitasone/auth";
import { buildApp } from "../src/app.js";

const SECRET = "test_secret_for_civitasone_32chr";
const TENANT = "aaaaaaaa-7777-4000-8000-000000000099";
const ACTOR = "00000000-0001-4000-8000-000000000001";

// ─── Token helpers ────────────────────────────────────────────────────────────
function validToken(roles: string[] = ["adapter_admin", "super_admin"]) {
  return signToken({ sub: ACTOR, tid: TENANT, roles, sid: "sess-001" }, SECRET);
}

function wrongRoleToken() {
  return signToken({ sub: ACTOR, tid: TENANT, roles: ["employee"], sid: "sess-002" }, SECRET);
}

// ═══════════════════════════════════════════════════════════════════════════════
// SERVICEABILITY
// ═══════════════════════════════════════════════════════════════════════════════
describe("GET /v1/adapters/apt/serviceability", () => {
  it("200 — returns serviceability data with valid token", async () => {
    const app = await buildApp();
    const res = await app.inject({
      method: "GET",
      url: "/v1/adapters/apt/serviceability?originPin=110001&destinationPin=400001",
      headers: { authorization: `Bearer ${validToken()}` },
    });
    await app.close();
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.data.serviceable).toBe(true);
    expect(body.data.originPin).toBe("110001");
    expect(body.data.destinationPin).toBe("400001");
    expect(body.data.availableServices).toContain("speed-post");
  });

  it("200 — works with logistics_officer role", async () => {
    const app = await buildApp();
    const res = await app.inject({
      method: "GET",
      url: "/v1/adapters/apt/serviceability",
      headers: { authorization: `Bearer ${validToken(["logistics_officer"])}` },
    });
    await app.close();
    expect(res.statusCode).toBe(200);
  });

  it("400 — rejects invalid pin code length", async () => {
    const app = await buildApp();
    const res = await app.inject({
      method: "GET",
      url: "/v1/adapters/apt/serviceability?originPin=123",
      headers: { authorization: `Bearer ${validToken()}` },
    });
    await app.close();
    expect(res.statusCode).toBe(400);
  });

  it("401 — rejects request without token", async () => {
    const app = await buildApp();
    const res = await app.inject({
      method: "GET",
      url: "/v1/adapters/apt/serviceability",
    });
    await app.close();
    expect(res.statusCode).toBe(401);
  });

  it("403 — rejects request with wrong role", async () => {
    const app = await buildApp();
    const res = await app.inject({
      method: "GET",
      url: "/v1/adapters/apt/serviceability",
      headers: { authorization: `Bearer ${wrongRoleToken()}` },
    });
    await app.close();
    expect(res.statusCode).toBe(403);
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// TRACKING
// ═══════════════════════════════════════════════════════════════════════════════
describe("GET /v1/adapters/apt/tracking/:articleId", () => {
  it("200 — returns tracking data with valid token", async () => {
    const app = await buildApp();
    const res = await app.inject({
      method: "GET",
      url: "/v1/adapters/apt/tracking/EM123456789IN",
      headers: { authorization: `Bearer ${validToken()}` },
    });
    await app.close();
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.data.articleId).toBe("EM123456789IN");
    expect(body.data.status).toBe("in-transit");
    expect(body.data.events).toEqual([]);
  });

  it("200 — works with tenant_admin role", async () => {
    const app = await buildApp();
    const res = await app.inject({
      method: "GET",
      url: "/v1/adapters/apt/tracking/SP999888777IN",
      headers: { authorization: `Bearer ${validToken(["tenant_admin"])}` },
    });
    await app.close();
    expect(res.statusCode).toBe(200);
    expect(res.json().data.articleId).toBe("SP999888777IN");
  });

  it("400 — rejects empty articleId", async () => {
    const app = await buildApp();
    // Fastify will match the route with param as empty string if trailing slash
    // but with min(1) validation and Fastify routing, we test an overly-long ID
    const res = await app.inject({
      method: "GET",
      url: "/v1/adapters/apt/tracking/" + "A".repeat(31),
      headers: { authorization: `Bearer ${validToken()}` },
    });
    await app.close();
    expect(res.statusCode).toBe(400);
  });

  it("401 — rejects request without token", async () => {
    const app = await buildApp();
    const res = await app.inject({
      method: "GET",
      url: "/v1/adapters/apt/tracking/EM123456789IN",
    });
    await app.close();
    expect(res.statusCode).toBe(401);
  });

  it("403 — rejects request with wrong role", async () => {
    const app = await buildApp();
    const res = await app.inject({
      method: "GET",
      url: "/v1/adapters/apt/tracking/EM123456789IN",
      headers: { authorization: `Bearer ${wrongRoleToken()}` },
    });
    await app.close();
    expect(res.statusCode).toBe(403);
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// BOOKING
// ═══════════════════════════════════════════════════════════════════════════════
describe("POST /v1/adapters/apt/booking", () => {
  const validPayload = {
    senderName: "Raj Kumar",
    senderPin: "110001",
    recipientName: "Priya Sharma",
    recipientPin: "400001",
    articleType: "speed-post",
    weight: 0.5,
  };

  it("202 — accepts booking with valid token and body", async () => {
    const app = await buildApp();
    const res = await app.inject({
      method: "POST",
      url: "/v1/adapters/apt/booking",
      headers: { authorization: `Bearer ${validToken()}` },
      payload: validPayload,
    });
    await app.close();
    expect(res.statusCode).toBe(202);
    const body = res.json();
    expect(body.data.bookingId).toBeDefined();
    expect(body.data.articleType).toBe("speed-post");
    expect(body.data.status).toBe("queued");
  });

  it("202 — accepts booking with declaredValue", async () => {
    const app = await buildApp();
    const res = await app.inject({
      method: "POST",
      url: "/v1/adapters/apt/booking",
      headers: { authorization: `Bearer ${validToken(["logistics_officer"])}` },
      payload: { ...validPayload, declaredValue: 5000 },
    });
    await app.close();
    expect(res.statusCode).toBe(202);
    expect(res.json().data.bookingId).toBeDefined();
  });

  it("400 — rejects empty body", async () => {
    const app = await buildApp();
    const res = await app.inject({
      method: "POST",
      url: "/v1/adapters/apt/booking",
      headers: { authorization: `Bearer ${validToken()}` },
      payload: {},
    });
    await app.close();
    expect(res.statusCode).toBe(400);
  });

  it("400 — rejects invalid pin code", async () => {
    const app = await buildApp();
    const res = await app.inject({
      method: "POST",
      url: "/v1/adapters/apt/booking",
      headers: { authorization: `Bearer ${validToken()}` },
      payload: { ...validPayload, senderPin: "12" },
    });
    await app.close();
    expect(res.statusCode).toBe(400);
  });

  it("400 — rejects negative weight", async () => {
    const app = await buildApp();
    const res = await app.inject({
      method: "POST",
      url: "/v1/adapters/apt/booking",
      headers: { authorization: `Bearer ${validToken()}` },
      payload: { ...validPayload, weight: -1 },
    });
    await app.close();
    expect(res.statusCode).toBe(400);
  });

  it("401 — rejects request without token", async () => {
    const app = await buildApp();
    const res = await app.inject({
      method: "POST",
      url: "/v1/adapters/apt/booking",
      payload: validPayload,
    });
    await app.close();
    expect(res.statusCode).toBe(401);
  });

  it("403 — rejects request with wrong role", async () => {
    const app = await buildApp();
    const res = await app.inject({
      method: "POST",
      url: "/v1/adapters/apt/booking",
      headers: { authorization: `Bearer ${wrongRoleToken()}` },
      payload: validPayload,
    });
    await app.close();
    expect(res.statusCode).toBe(403);
  });
});
