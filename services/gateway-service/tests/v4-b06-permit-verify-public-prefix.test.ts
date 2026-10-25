/**
 * V4-B-06: the anonymous permit QR-verification endpoints of advertisement-service and
 * building-service must get past the gateway bearer pre-check, while every other route of those
 * services keeps its edge authentication.
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

describe("permit verify public prefixes", () => {
  it.each(["/api/v1/advertisement/permits/verify?code=abc", "/api/v1/building/permits/verify?code=abc"])(
    "lets an anonymous request through to %s",
    async (url) => {
      const app = await buildApp();
      const res = await app.inject({ method: "GET", url });
      expect(res.statusCode).not.toBe(401);
      expect(upstreamCalls.some((u) => u.includes("/permits/verify?code=abc"))).toBe(true);
      await app.close();
    },
  );

  it("still requires a token for every other advertisement / building permit route", async () => {
    const app = await buildApp();
    for (const url of [
      "/api/v1/advertisement/permits", "/api/v1/advertisement/permits/00000000-0000-4000-8000-000000000000",
      "/api/v1/building/permits", "/api/v1/building/permits/00000000-0000-4000-8000-000000000000",
      "/api/v1/building/permits/verifyx",
    ]) {
      const res = await app.inject({ method: "GET", url });
      expect(res.statusCode).toBe(401);
    }
    expect(upstreamCalls).toHaveLength(0);
    await app.close();
  });
});
