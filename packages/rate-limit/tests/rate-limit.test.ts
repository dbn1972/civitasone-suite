import { describe, it, expect } from "vitest";
import Fastify from "fastify";
import { registerRateLimit } from "../src/index.js";

// Non-loopback client: loopback is allow-listed by default (C1).
const EXT = "203.0.113.7";

describe("@civitasone/rate-limit", () => {
  it("registers the plugin without errors", async () => {
    const app = Fastify();
    await registerRateLimit(app, { max: 5, timeWindow: "1 minute" });
    app.get("/test", async () => ({ ok: true }));
    await app.ready();
    const res = await app.inject({ method: "GET", url: "/test", remoteAddress: EXT });
    expect(res.statusCode).toBe(200);
    await app.close();
  });

  it("returns 429 after exceeding the limit", async () => {
    const app = Fastify();
    await registerRateLimit(app, { max: 3, timeWindow: "1 minute" });
    app.get("/limited", async () => ({ ok: true }));
    await app.ready();

    // Make requests up to the limit
    for (let i = 0; i < 3; i++) {
      const res = await app.inject({ method: "GET", url: "/limited", remoteAddress: EXT });
      expect(res.statusCode).toBe(200);
    }

    // Next request should be rate-limited
    const res = await app.inject({ method: "GET", url: "/limited", remoteAddress: EXT });
    expect(res.statusCode).toBe(429);
    const body = JSON.parse(res.body);
    expect(body.error).toBe("TOO_MANY_REQUESTS");
    expect(body.retryAfter).toBeGreaterThan(0);
    await app.close();
  });

  it("includes rate limit headers in responses", async () => {
    const app = Fastify();
    await registerRateLimit(app, { max: 10, timeWindow: "1 minute" });
    app.get("/headers", async () => ({ ok: true }));
    await app.ready();

    const res = await app.inject({ method: "GET", url: "/headers", remoteAddress: EXT });
    expect(res.headers["x-ratelimit-limit"]).toBeDefined();
    expect(res.headers["x-ratelimit-remaining"]).toBeDefined();
    await app.close();
  });

  it("uses per-tenant key generation", async () => {
    const app = Fastify();
    await registerRateLimit(app, { max: 2, timeWindow: "1 minute", allowList: [] });
    app.get("/tenant", async (req) => {
      // Simulate different tenants by decorating the request
      return { ip: req.ip };
    });
    await app.ready();

    // Requests from same IP still share the rate limit pool
    const res1 = await app.inject({ method: "GET", url: "/tenant", remoteAddress: EXT });
    const res2 = await app.inject({ method: "GET", url: "/tenant", remoteAddress: EXT });
    expect(res1.statusCode).toBe(200);
    expect(res2.statusCode).toBe(200);

    // Third request should be limited (max: 2)
    const res3 = await app.inject({ method: "GET", url: "/tenant", remoteAddress: EXT });
    expect(res3.statusCode).toBe(429);
    await app.close();
  });

  it("loopback clients bypass the limit by default (C1)", async () => {
    const app = Fastify();
    await registerRateLimit(app, { max: 2, timeWindow: "1 minute" });
    app.get("/lo", async () => ({ ok: true }));
    await app.ready();
    for (let i = 0; i < 6; i++) {
      const res = await app.inject({ method: "GET", url: "/lo", remoteAddress: "127.0.0.1" });
      expect(res.statusCode).toBe(200);
    }
    await app.close();
  });

  it("non-loopback clients are still limited (C1)", async () => {
    const app = Fastify();
    await registerRateLimit(app, { max: 2, timeWindow: "1 minute" });
    app.get("/ext", async () => ({ ok: true }));
    await app.ready();
    const codes: number[] = [];
    for (let i = 0; i < 4; i++) {
      codes.push((await app.inject({ method: "GET", url: "/ext", remoteAddress: EXT })).statusCode);
    }
    expect(codes).toEqual([200, 200, 429, 429]);
    await app.close();
  });

  it("an explicit empty allowList disables the bypass", async () => {
    const app = Fastify();
    await registerRateLimit(app, { max: 1, timeWindow: "1 minute", allowList: [] });
    app.get("/x", async () => ({ ok: true }));
    await app.ready();
    await app.inject({ method: "GET", url: "/x", remoteAddress: "::1" });
    const res = await app.inject({ method: "GET", url: "/x", remoteAddress: "::1" });
    expect(res.statusCode).toBe(429);
    await app.close();
  });
});
