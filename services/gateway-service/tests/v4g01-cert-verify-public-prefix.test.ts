/**
 * V4-G-01: the anonymous QR-scan certificate verification
 * (citizen-service GET /v1/citizen/certificates/verify/:token) must get past the gateway's bearer
 * pre-check, while every other certificate route stays authenticated.
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

describe("certificate verify public prefix", () => {
  it("lets an anonymous request through to the public token route", async () => {
    const app = await buildApp();
    const res = await app.inject({ method: "GET", url: "/api/v1/citizen/certificates/verify/abc" });
    expect(res.statusCode).not.toBe(401);
    expect(upstreamCalls.some((u) => u.includes("/v1/citizen/certificates/verify/abc"))).toBe(true);
    await app.close();
  });

  it("still requires a token for every other certificate route", async () => {
    const app = await buildApp();
    for (const url of [
      "/api/v1/citizen/certificates",
      "/api/v1/citizen/certificates/00000000-0000-4000-8000-000000000001",
      "/api/v1/citizen/certificates/verifyx/abc",
      "/api/v1/citizen/applications",
    ]) {
      const res = await app.inject({ method: "GET", url });
      expect(res.statusCode, url).toBe(401);
    }
    expect(upstreamCalls).toHaveLength(0);
    await app.close();
  });
});
