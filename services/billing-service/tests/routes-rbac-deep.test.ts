/**
 * Billing Service — Route-Level RBAC + Validation Tests.
 *
 * Tests authentication (401), authorization (403), validation (400),
 * and happy-path (202/200) for subscription and invoice endpoints.
 *
 * Source: modules/subscriptions/routes.ts, modules/invoices/routes.ts
 */
import { describe, it, expect, afterAll } from "vitest";
import { signToken } from "@civitasone/auth";
import { sqlClient } from "../src/shared/db.js";
import { buildApp } from "../src/app.js";

const SECRET = process.env.JWT_SECRET as string;
const TENANT = "bb220001-1111-4000-8000-000000b10001";
const ACTOR = "bb22aaaa-1111-4000-8000-000000b1000a";

function token(roles: string[], tid = TENANT): string {
  return signToken({ sub: ACTOR, tid, roles, sid: "sess-bill" }, SECRET, 3600);
}
const superBearer = () => ({ authorization: `Bearer ${token(["super_admin"])}` });
const billingBearer = () => ({ authorization: `Bearer ${token(["billing_admin"])}` });
const unrelatedBearer = () => ({ authorization: `Bearer ${token(["employee"])}` });

afterAll(async () => { await sqlClient.end(); });

// ═══ Subscriptions — super_admin required ═══

describe("POST /v1/billing/subscriptions — auth", () => {
  it("401 without token", async () => {
    const app = await buildApp();
    const res = await app.inject({ method: "POST", url: "/v1/billing/subscriptions", payload: {} });
    await app.close();
    expect(res.statusCode).toBe(401);
  });

  it("403 for non-super_admin role", async () => {
    const app = await buildApp();
    const res = await app.inject({
      method: "POST", url: "/v1/billing/subscriptions",
      headers: unrelatedBearer(), payload: { tenantId: TENANT, planId: "plan-1" },
    });
    await app.close();
    expect(res.statusCode).toBe(403);
  });

  it("400 for missing required fields", async () => {
    const app = await buildApp();
    const res = await app.inject({
      method: "POST", url: "/v1/billing/subscriptions",
      headers: superBearer(), payload: {},
    });
    await app.close();
    expect(res.statusCode).toBe(400);
  });
});

describe("GET /v1/billing/subscriptions — auth", () => {
  it("401 without token", async () => {
    const app = await buildApp();
    const res = await app.inject({ method: "GET", url: "/v1/billing/subscriptions" });
    await app.close();
    expect(res.statusCode).toBe(401);
  });
});

// ═══ Invoices — BILLING_ROLES required ═══

describe("POST /v1/billing/invoices — RBAC", () => {
  it("401 without token", async () => {
    const app = await buildApp();
    const res = await app.inject({ method: "POST", url: "/v1/billing/invoices", payload: {} });
    await app.close();
    expect(res.statusCode).toBe(401);
  });

  it("403 for unrelated role", async () => {
    const app = await buildApp();
    const res = await app.inject({
      method: "POST", url: "/v1/billing/invoices",
      headers: unrelatedBearer(), payload: { tenantId: TENANT },
    });
    await app.close();
    expect(res.statusCode).toBe(403);
  });

  it("400 for missing body fields with super_admin", async () => {
    const app = await buildApp();
    const res = await app.inject({
      method: "POST", url: "/v1/billing/invoices",
      headers: superBearer(), payload: {},
    });
    await app.close();
    expect(res.statusCode).toBe(400);
  });
});

describe("GET /v1/billing/invoices — RBAC", () => {
  it("401 without token", async () => {
    const app = await buildApp();
    const res = await app.inject({ method: "GET", url: "/v1/billing/invoices" });
    await app.close();
    expect(res.statusCode).toBe(401);
  });

  it("200 for billing_admin", async () => {
    const app = await buildApp();
    const res = await app.inject({
      method: "GET", url: "/v1/billing/invoices",
      headers: billingBearer(),
    });
    await app.close();
    expect(res.statusCode).toBe(200);
  });
});
