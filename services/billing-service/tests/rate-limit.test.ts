import { describe, it, expect, vi, beforeAll, afterAll } from "vitest";
import { signToken } from "@civitasone/auth";
import type { FastifyInstance } from "fastify";

/**
 * CodeQL js/missing-rate-limiting (#4108 #4109 #4112): billing-service must register the shared
 * rate limiter. Public payment-provider webhooks get a generous per-IP limit (300/min, room for
 * provider retries); checkout/initiate routes get a per-actor limit (30/min).
 */

const SECRET = "test_secret_for_civitasone_32chr";
const TENANT = "11111111-aaaa-4000-8000-0000000000a1";
const ACTOR_A = globalThis.crypto.randomUUID();
const ACTOR_B = globalThis.crypto.randomUUID();
const EXTERNAL_IP = "203.0.113.7";

const bearer = (actor: string) => ({
  authorization: `Bearer ${signToken({ sub: actor, tid: TENANT, roles: ["billing_admin"], sid: "sess-rl" }, SECRET, 3600)}`,
  "content-type": "application/json",
});

describe("billing-service rate limiting", () => {
  let app: FastifyInstance;

  beforeAll(async () => {
    vi.stubEnv("JWT_SECRET", SECRET);
    const { buildApp } = await import("../src/app.js");
    app = await buildApp();
    await app.ready();
  });
  afterAll(async () => {
    await app.close();
    vi.unstubAllEnvs();
  });

  it("public webhook: a burst from one IP beyond 300/min gets 429; traffic under the limit passes", async () => {
    const hit = () =>
      app.inject({ method: "POST", url: "/v1/billing/webhooks/payu", remoteAddress: EXTERNAL_IP, payload: {} });
    const statuses: number[] = [];
    for (let i = 0; i < 305; i++) statuses.push((await hit()).statusCode);
    expect(statuses.slice(0, 300).every((s) => s !== 429)).toBe(true);
    expect(statuses.slice(300).every((s) => s === 429)).toBe(true);
    // a different provider IP has its own bucket (provider retries from other hosts are unaffected)
    const other = await app.inject({ method: "POST", url: "/v1/billing/webhooks/ccavenue", remoteAddress: "203.0.113.8", payload: {} });
    expect(other.statusCode).not.toBe(429);
  });

  it("checkout: a per-actor burst beyond 30/min gets 429 while another actor is unaffected", async () => {
    const hit = (actor: string) =>
      app.inject({ method: "POST", url: "/v1/billing/checkout", remoteAddress: EXTERNAL_IP, headers: bearer(actor), payload: {} });
    const statuses: number[] = [];
    for (let i = 0; i < 33; i++) statuses.push((await hit(ACTOR_A)).statusCode);
    expect(statuses.slice(0, 30).every((s) => s !== 429)).toBe(true);
    expect(statuses.slice(30).every((s) => s === 429)).toBe(true);
    expect((await hit(ACTOR_B)).statusCode).not.toBe(429);
  });

  it("behind the gateway (internal peer) webhook buckets are per forwarded client, not one shared gateway bucket", async () => {
    const hit = (xff: string) =>
      app.inject({ method: "POST", url: "/v1/billing/webhooks/razorpay", remoteAddress: "10.0.0.5", headers: { "x-forwarded-for": xff }, payload: {} });
    for (let i = 0; i < 300; i++) expect((await hit("198.51.100.1")).statusCode).not.toBe(429);
    expect((await hit("198.51.100.1")).statusCode).toBe(429);
    expect((await hit("198.51.100.2")).statusCode).not.toBe(429);
  });

  it("an external peer cannot forge x-forwarded-for to dodge or poison the limit", async () => {
    const hit = (xff: string) =>
      app.inject({ method: "POST", url: "/v1/billing/webhooks/ccavenue", remoteAddress: "203.0.113.99", headers: { "x-forwarded-for": xff }, payload: {} });
    for (let i = 0; i < 300; i++) await hit(`192.0.2.${i % 250}`);
    expect((await hit("192.0.2.250")).statusCode).toBe(429);
  });

  it.each(["/v1/billing/payments/verify", "/v1/billing/payments/initiate"])(
    "%s: per-actor burst beyond 30/min gets 429 with Retry-After and RATE_LIMITED body",
    async (url) => {
      const actor = globalThis.crypto.randomUUID();
      const hit = () => app.inject({ method: "POST", url, remoteAddress: EXTERNAL_IP, headers: bearer(actor), payload: {} });
      for (let i = 0; i < 30; i++) expect((await hit()).statusCode).not.toBe(429);
      const res = await hit();
      expect(res.statusCode).toBe(429);
      expect(Number(res.headers["retry-after"])).toBeGreaterThan(0);
      expect(res.json()).toMatchObject({ code: "RATE_LIMITED", retryable: true });
    },
  );

  it("ops endpoints are never rate limited", async () => {
    for (let i = 0; i < 5; i++) {
      const r = await app.inject({ method: "GET", url: "/health", remoteAddress: EXTERNAL_IP });
      expect(r.statusCode).not.toBe(429);
    }
  });
});
