/**
 * GAP-RECRUITMENT-CAREERS-DETAIL-04: the public careers resume upload needs a larger body than the
 * global 1 MB cap (a 5 MB file is ~6.7 MB as base64). The lift must be limited to that one path.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { buildApp } from "../src/app.js";

let upstreamCalls: string[] = [];
beforeEach(() => {
  upstreamCalls = [];
  vi.stubGlobal("fetch", async (url: string) => {
    upstreamCalls.push(String(url));
    return new Response(JSON.stringify({ ok: true }), { status: 200, headers: { "content-type": "application/json" } });
  });
});
afterEach(() => { vi.unstubAllGlobals(); });

const bigBody = (bytes: number) => JSON.stringify({ tenantId: "t", contentBase64: "A".repeat(bytes) });

describe("careers resume upload body limit", () => {
  it("accepts a ~5 MB base64 upload on POST /api/v1/careers/resume", async () => {
    const app = await buildApp();
    const res = await app.inject({ method: "POST", url: "/api/v1/careers/resume", headers: { "content-type": "application/json" }, payload: bigBody(6_500_000) });
    expect(res.statusCode).not.toBe(413);
    expect(upstreamCalls.some((u) => u.includes("/v1/careers/resume"))).toBe(true);
    await app.close();
  });

  it("still refuses a body above 7 MB on that route", async () => {
    const app = await buildApp();
    const res = await app.inject({ method: "POST", url: "/api/v1/careers/resume", headers: { "content-type": "application/json" }, payload: bigBody(7_200_000) });
    expect(res.statusCode).toBe(413);
    await app.close();
  });

  it("keeps the global 1 MB cap on every other careers route", async () => {
    const app = await buildApp();
    const res = await app.inject({ method: "POST", url: "/api/v1/careers/apply", headers: { "content-type": "application/json" }, payload: bigBody(2_000_000) });
    expect(res.statusCode).toBe(413);
    expect(upstreamCalls).toEqual([]);
    await app.close();
  });
});
