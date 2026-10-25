/**
 * V4-B-03: payment-gateway callbacks carry no bearer token, so the gateway must let
 * /api/v1/billing/webhooks/* through to billing-service (which verifies the provider signature),
 * while every other billing route keeps its edge authentication.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { buildApp } from "../src/app.js";

let upstreamCalls: string[] = [];
let upstreamInit: RequestInit | undefined;
beforeEach(() => {
  upstreamCalls = [];
  upstreamInit = undefined;
  vi.stubGlobal("fetch", async (url: string, init?: RequestInit) => {
    upstreamCalls.push(String(url));
    upstreamInit = init;
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

  it("forwards the RAW JSON body byte-for-byte (not re-serialised) plus the provider signature, dropping identity headers", async () => {
    const app = await buildApp();
    const raw = '{ "event" : "payment.captured",\n  "payload":{"a":1.0} }';
    const res = await app.inject({
      method: "POST",
      url: "/api/v1/billing/webhooks/razorpay",
      headers: { "content-type": "application/json", "x-razorpay-signature": "sig123", "x-tenant-id": "evil", authorization: "Bearer x" },
      payload: raw,
    });
    expect(res.statusCode).not.toBe(401);
    expect(upstreamInit?.body).toBe(raw);
    const h = upstreamInit?.headers as Record<string, string>;
    expect(h["x-razorpay-signature"]).toBe("sig123");
    expect(h["x-tenant-id"]).toBeUndefined();
    expect(h["authorization"]).toBeUndefined();
    await app.close();
  });

  it("passes a form-urlencoded PayU/CCAvenue callback through unmodified (no 415)", async () => {
    const app = await buildApp();
    const raw = "status=success&txnid=t1&hash=ab%2Bc";
    for (const p of ["payu", "ccavenue"]) {
      const res = await app.inject({ method: "POST", url: `/api/v1/billing/webhooks/${p}`, headers: { "content-type": "application/x-www-form-urlencoded" }, payload: raw });
      expect(res.statusCode).toBe(200);
      expect(upstreamInit?.body).toBe(raw);
      expect((upstreamInit?.headers as Record<string, string>)["content-type"]).toBe("application/x-www-form-urlencoded");
    }
    await app.close();
  });
});
