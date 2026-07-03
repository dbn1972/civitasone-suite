/**
 * tenant-service — self-service subscription upgrade/downgrade route tests.
 * Tests new plan routes, upgrade, downgrade, cancel, invoice history.
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
  return signToken({ sub: ACTOR, tid: tenantId, roles, sid: "sess-su" }, SECRET, 3600);
}

function authHeader(roles?: string[], tenantId?: string) {
  return { authorization: `Bearer ${token(roles, tenantId)}` };
}

let app: FastifyInstance;

beforeAll(async () => { app = await buildApp(); });
afterAll(async () => { await app.close(); await sqlClient.end(); });

// ══════════════════════════════════════════════════════════════════════════════
// GET /v1/tenant/plans — LIST AVAILABLE PLANS
// ══════════════════════════════════════════════════════════════════════════════
describe("GET /v1/tenant/plans", () => {
  it("returns 200 with plan list for authenticated user", async () => {
    const res = await app.inject({ method: "GET", url: "/v1/tenant/plans", headers: authHeader(["tenant_admin"]) });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.data).toBeInstanceOf(Array);
    expect(body.data.length).toBe(3);
  });

  it("returns plans with expected structure", async () => {
    const res = await app.inject({ method: "GET", url: "/v1/tenant/plans", headers: authHeader(["employee"]) });
    // Any authenticated user can view plans
    expect(res.statusCode).toBe(200);
    const plan = res.json().data[0];
    expect(plan).toHaveProperty("id");
    expect(plan).toHaveProperty("name");
    expect(plan).toHaveProperty("pricePerMonth");
    expect(plan).toHaveProperty("maxUsers");
    expect(plan).toHaveProperty("modules");
  });

  it("returns 401 without auth", async () => {
    const res = await app.inject({ method: "GET", url: "/v1/tenant/plans" });
    expect(res.statusCode).toBe(401);
  });
});

// ══════════════════════════════════════════════════════════════════════════════
// GET /v1/tenant/subscription/current
// ══════════════════════════════════════════════════════════════════════════════
describe("GET /v1/tenant/subscription/current", () => {
  it("does not return 403 for tenant_admin", async () => {
    const res = await app.inject({ method: "GET", url: "/v1/tenant/subscription/current", headers: authHeader(["tenant_admin"]) });
    expect(res.statusCode).not.toBe(403);
    expect(res.statusCode).not.toBe(401);
  });

  it("returns 403 for employee", async () => {
    const res = await app.inject({ method: "GET", url: "/v1/tenant/subscription/current", headers: authHeader(["employee"]) });
    expect(res.statusCode).toBe(403);
  });

  it("returns 401 without token", async () => {
    const res = await app.inject({ method: "GET", url: "/v1/tenant/subscription/current" });
    expect(res.statusCode).toBe(401);
  });
});

// ══════════════════════════════════════════════════════════════════════════════
// POST /v1/tenant/subscription/upgrade
// ══════════════════════════════════════════════════════════════════════════════
describe("POST /v1/tenant/subscription/upgrade", () => {
  it("returns 202 with valid upgrade body", async () => {
    const res = await app.inject({
      method: "POST", url: "/v1/tenant/subscription/upgrade",
      headers: authHeader(["tenant_admin"]),
      payload: { targetPlanId: VALID_UUID, paymentMethod: "razorpay" },
    });
    expect(res.statusCode).toBe(202);
    const body = res.json();
    expect(body.status).toBe("accepted");
    expect(body.razorpayOrderId).toBeDefined();
  });

  it("returns 202 with default payment method", async () => {
    const res = await app.inject({
      method: "POST", url: "/v1/tenant/subscription/upgrade",
      headers: authHeader(["super_admin"]),
      payload: { targetPlanId: VALID_UUID },
    });
    expect(res.statusCode).toBe(202);
  });

  it("returns 400 with missing targetPlanId", async () => {
    const res = await app.inject({
      method: "POST", url: "/v1/tenant/subscription/upgrade",
      headers: authHeader(["tenant_admin"]),
      payload: {},
    });
    expect(res.statusCode).toBe(400);
  });

  it("returns 400 with invalid planId format", async () => {
    const res = await app.inject({
      method: "POST", url: "/v1/tenant/subscription/upgrade",
      headers: authHeader(["tenant_admin"]),
      payload: { targetPlanId: "not-a-uuid" },
    });
    expect(res.statusCode).toBe(400);
  });

  it("returns 403 for employee", async () => {
    const res = await app.inject({
      method: "POST", url: "/v1/tenant/subscription/upgrade",
      headers: authHeader(["employee"]),
      payload: { targetPlanId: VALID_UUID },
    });
    expect(res.statusCode).toBe(403);
  });
});

// ══════════════════════════════════════════════════════════════════════════════
// POST /v1/tenant/subscription/downgrade
// ══════════════════════════════════════════════════════════════════════════════
describe("POST /v1/tenant/subscription/downgrade", () => {
  it("returns 202 with valid downgrade body", async () => {
    const res = await app.inject({
      method: "POST", url: "/v1/tenant/subscription/downgrade",
      headers: authHeader(["tenant_admin"]),
      payload: { targetPlanId: VALID_UUID, acknowledgement: true },
    });
    expect(res.statusCode).toBe(202);
  });

  it("returns 400 without acknowledgement", async () => {
    const res = await app.inject({
      method: "POST", url: "/v1/tenant/subscription/downgrade",
      headers: authHeader(["tenant_admin"]),
      payload: { targetPlanId: VALID_UUID, acknowledgement: false },
    });
    expect(res.statusCode).toBe(400);
  });

  it("returns 400 without targetPlanId", async () => {
    const res = await app.inject({
      method: "POST", url: "/v1/tenant/subscription/downgrade",
      headers: authHeader(["tenant_admin"]),
      payload: { acknowledgement: true },
    });
    expect(res.statusCode).toBe(400);
  });

  it("returns 403 for employee", async () => {
    const res = await app.inject({
      method: "POST", url: "/v1/tenant/subscription/downgrade",
      headers: authHeader(["employee"]),
      payload: { targetPlanId: VALID_UUID, acknowledgement: true },
    });
    expect(res.statusCode).toBe(403);
  });
});

// ══════════════════════════════════════════════════════════════════════════════
// POST /v1/tenant/subscription/cancel
// ══════════════════════════════════════════════════════════════════════════════
describe("POST /v1/tenant/subscription/cancel", () => {
  it("returns 202 with valid cancel body", async () => {
    const res = await app.inject({
      method: "POST", url: "/v1/tenant/subscription/cancel",
      headers: authHeader(["tenant_admin"]),
      payload: { reason: "Switching to competitor product" },
    });
    expect(res.statusCode).toBe(202);
  });

  it("returns 400 with reason too short", async () => {
    const res = await app.inject({
      method: "POST", url: "/v1/tenant/subscription/cancel",
      headers: authHeader(["tenant_admin"]),
      payload: { reason: "ab" },
    });
    expect(res.statusCode).toBe(400);
  });

  it("returns 400 with missing reason", async () => {
    const res = await app.inject({
      method: "POST", url: "/v1/tenant/subscription/cancel",
      headers: authHeader(["tenant_admin"]),
      payload: {},
    });
    expect(res.statusCode).toBe(400);
  });

  it("returns 403 for employee", async () => {
    const res = await app.inject({
      method: "POST", url: "/v1/tenant/subscription/cancel",
      headers: authHeader(["employee"]),
      payload: { reason: "Not needed anymore" },
    });
    expect(res.statusCode).toBe(403);
  });
});

// ══════════════════════════════════════════════════════════════════════════════
// GET /v1/tenant/subscription/invoice-history
// ══════════════════════════════════════════════════════════════════════════════
describe("GET /v1/tenant/subscription/invoice-history", () => {
  it("returns 200 for tenant_admin", async () => {
    const res = await app.inject({ method: "GET", url: "/v1/tenant/subscription/invoice-history", headers: authHeader(["tenant_admin"]) });
    expect(res.statusCode).toBe(200);
    expect(res.json().data).toBeInstanceOf(Array);
  });

  it("returns 403 for employee", async () => {
    const res = await app.inject({ method: "GET", url: "/v1/tenant/subscription/invoice-history", headers: authHeader(["employee"]) });
    expect(res.statusCode).toBe(403);
  });

  it("returns 401 without token", async () => {
    const res = await app.inject({ method: "GET", url: "/v1/tenant/subscription/invoice-history" });
    expect(res.statusCode).toBe(401);
  });
});
