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
