/**
 * CodeQL js/missing-rate-limiting: the production app (buildApp) must register the shared
 * @civitasone/rate-limit plugin so every route handler (incl. the DB-touching write routes) is limited.
 */
import { describe, it, expect, vi } from "vitest";

vi.mock("../src/shared/infra.js", () => ({
  invalidateSafely: vi.fn().mockResolvedValue(undefined),
  cache: { put: vi.fn(), get: vi.fn().mockResolvedValue(null), getOrLoad: vi.fn(), invalidate: vi.fn(), makeKey: vi.fn() },
  queue: { publish: vi.fn(), subscribe: vi.fn(), start: vi.fn(), stop: vi.fn(), healthCheck: vi.fn().mockResolvedValue({ healthy: true }) },
}));
vi.mock("../src/shared/pii-crypto.js", async (orig) => ({ ...(await orig<Record<string, unknown>>()), assertPiiKeyConfigured: vi.fn() }));

describe("visitor-service rate limiting", () => {
  it("registers @fastify/rate-limit on the production app", async () => {
    const { buildApp } = await import("../src/app.js");
    const app = await buildApp();
    try {
      expect(app.hasPlugin("@fastify/rate-limit")).toBe(true);
    } finally {
      await app.close();
    }
  });

  it("trusts the gateway hop so req.ip is the real client, not the shared gateway address", async () => {
    const { buildApp } = await import("../src/app.js");
    const app = await buildApp();
    try {
      // onResponse still fires for the auth-rejected (401) probe requests, so req.ip can be observed without a token.
      const seen: string[] = [];
      app.addHook("onResponse", async (req) => { seen.push(req.ip); });
      await app.inject({ method: "GET", url: "/__client-ip-probe", remoteAddress: "10.0.0.5", headers: { "x-forwarded-for": "203.0.113.9" } });
      // an untrusted (public) peer must NOT be able to spoof the key via the header
      await app.inject({ method: "GET", url: "/__client-ip-probe", remoteAddress: "198.51.100.7", headers: { "x-forwarded-for": "203.0.113.9" } });
      expect(seen).toEqual(["203.0.113.9", "198.51.100.7"]);
    } finally {
      await app.close();
    }
  });
});

describe("visitor-service rate limiting — buckets and device routes", () => {
  // Public device route: authPlugin lets it through, the rate-limit onRequest hook counts it, then deviceAuth
  // rejects the credential-less probe with 401, so a 429 can only come from the limiter.
  const DEVICE_URL = "/v1/visitor/turnstiles/passage";
  const GATEWAY = "10.0.0.5";
  type App = Awaited<ReturnType<(typeof import("../src/app.js"))["buildApp"]>>;

  async function hit(app: App, clientIp: string): Promise<number> {
    const res = await app.inject({ method: "POST", url: DEVICE_URL, remoteAddress: GATEWAY, headers: { "x-forwarded-for": clientIp }, payload: {} });
    return res.statusCode;
  }

  function restoreEnv(prev: string | undefined): void {
    if (prev === undefined) delete process.env.VISITOR_DEVICE_ROUTE_RATE_LIMIT;
    else process.env.VISITOR_DEVICE_ROUTE_RATE_LIMIT = prev;
  }

  it("puts different X-Forwarded-For clients (behind the same gateway hop) in different buckets", async () => {
    const prev = process.env.VISITOR_DEVICE_ROUTE_RATE_LIMIT;
    process.env.VISITOR_DEVICE_ROUTE_RATE_LIMIT = "3";
    const { buildApp } = await import("../src/app.js");
    const app = await buildApp();
    try {
      const first: number[] = [];
      for (let i = 0; i < 4; i++) first.push(await hit(app, "203.0.113.10"));
      expect(first.slice(0, 3)).not.toContain(429);
      expect(first[3]).toBe(429);
      // a different real client behind the SAME gateway socket peer has its own, untouched bucket
      expect(await hit(app, "203.0.113.11")).not.toBe(429);
    } finally {
      await app.close();
      restoreEnv(prev);
    }
  });

  it("does not throttle one NAT address of devices at the 300/min service-wide limit", async () => {
    const prev = process.env.VISITOR_DEVICE_ROUTE_RATE_LIMIT;
    delete process.env.VISITOR_DEVICE_ROUTE_RATE_LIMIT; // default ceiling
    const { buildApp } = await import("../src/app.js");
    const app = await buildApp();
    try {
      // 4 turnstiles x 120/min (deviceAuth per-device allowance) = 480 from one site address
      const statuses: number[] = [];
      for (let i = 0; i < 480; i++) statuses.push(await hit(app, "203.0.113.20"));
      expect(statuses.filter((s) => s === 429)).toHaveLength(0);
      expect(statuses[0]).toBe(401); // reached deviceAuth, i.e. the probe really exercised the route
    } finally {
      await app.close();
      restoreEnv(prev);
    }
  });

  it("keeps a bounded per-address ceiling (default 6000/min; invalid overrides fall back to it)", async () => {
    const { deviceRouteRateLimitMax, DEFAULT_DEVICE_ROUTE_RATE_LIMIT } = await import("../src/modules/device-registry/device-route-rate-limit.js");
    const prev = process.env.VISITOR_DEVICE_ROUTE_RATE_LIMIT;
    try {
      delete process.env.VISITOR_DEVICE_ROUTE_RATE_LIMIT;
      expect(deviceRouteRateLimitMax()).toBe(DEFAULT_DEVICE_ROUTE_RATE_LIMIT);
      expect(DEFAULT_DEVICE_ROUTE_RATE_LIMIT).toBe(6000);
      for (const bad of ["0", "-5", "abc", "1.5"]) {
        process.env.VISITOR_DEVICE_ROUTE_RATE_LIMIT = bad;
        expect(deviceRouteRateLimitMax()).toBe(DEFAULT_DEVICE_ROUTE_RATE_LIMIT);
      }
    } finally {
      restoreEnv(prev);
    }
  });
});
