/**
 * #1776: the anonymous QR-scan vCard download (hrms-service GET /v1/hrms/visiting-card/public/:token)
 * must get past the gateway's bearer pre-check, while every other visiting-card route stays authenticated.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { buildApp } from "../src/app.js";

let upstreamCalls: string[] = [];
beforeEach(() => {
  upstreamCalls = [];
  vi.stubGlobal("fetch", async (url: string) => {
    upstreamCalls.push(String(url));
    return new Response("BEGIN:VCARD", { status: 200, headers: { "content-type": "text/vcard" } });
  });
});
afterEach(() => { vi.unstubAllGlobals(); });

describe("visiting-card public prefix", () => {
  it("lets an anonymous request through to the public token route", async () => {
    const app = await buildApp();
    const res = await app.inject({ method: "GET", url: "/api/v1/hrms/visiting-card/public/abc" });
    expect(res.statusCode).not.toBe(401);
    expect(upstreamCalls.some((u) => u.includes("/v1/hrms/visiting-card/public/abc"))).toBe(true);
    await app.close();
  });

  it("still requires a token for the authenticated visiting-card routes", async () => {
    const app = await buildApp();
    for (const url of ["/api/v1/hrms/visiting-card/me", "/api/v1/hrms/visiting-card/me/share-token"]) {
      const res = await app.inject({ method: "GET", url });
      expect(res.statusCode).toBe(401);
    }
    expect(upstreamCalls).toHaveLength(0);
    await app.close();
  });
});
