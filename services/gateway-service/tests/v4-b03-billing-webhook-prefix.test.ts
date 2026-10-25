/**
 * V4-B-03: payment-gateway callbacks carry no bearer token, so the gateway must let
 * /api/v1/billing/webhooks/* through to billing-service (which verifies the provider signature),
 * while every other billing route keeps its edge authentication.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { buildApp } from "../src/app.js";

let upstreamCalls: string[] = [];
beforeEach(() => {
  upstreamCalls = [];
  vi.stubGlobal("fetch", async (url: string) => {
    upstreamCalls.push(String(url));
    return new Response("{}", { status: 200, headers: { "content-type": "application/json" } });
  });
});
afterEach(() => { vi.unstubAllGlobals(); });

describe("billing webhook public prefix", () => {
  it("lets an anonymous gateway callback through to billing-service", async () => {
    const app = await buildApp();
    const res = await app.inject({ method: "POST", url: "/api/v1/billing/webhooks/razorpay", payload: { event: "payment.captured" } });
    expect(res.statusCode).not.toBe(401);
    expect(upstreamCalls.some((u) => u.includes("/v1/billing/webhooks/razorpay"))).toBe(true);
    await app.close();
  });

  it("still requires a token for every other billing route", async () => {
    const app = await buildApp();
    for (const url of ["/api/v1/billing/plans", "/api/v1/billing/checkout", "/api/v1/billing/payments/initiate", "/api/v1/billing/webhooksx"]) {
      const res = await app.inject({ method: "POST", url, payload: {} });
      expect(res.statusCode).toBe(401);
    }
    expect(upstreamCalls).toHaveLength(0);
    await app.close();
  });
});
