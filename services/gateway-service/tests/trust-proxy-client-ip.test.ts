/**
 * The gateway forwards req.ip upstream as X-Forwarded-For (and keys rate limits on it). It must believe an incoming
 * X-Forwarded-For only from internal peers (the web tier), never from an external caller reaching it directly.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { buildApp } from "../src/app.js";

let seen: Array<Record<string, string>> = [];
beforeEach(() => {
  seen = [];
  vi.stubGlobal("fetch", async (_url: string, init?: RequestInit) => {
    seen.push(init?.headers as Record<string, string>);
    return new Response(JSON.stringify({ ok: true }), { status: 200, headers: { "content-type": "application/json" } });
  });
});
afterEach(() => vi.unstubAllGlobals());

const call = async (remoteAddress: string, xff: string) => {
  const app = await buildApp();
  await app.inject({ method: "POST", url: "/api/v1/careers/resume", remoteAddress, headers: { "x-forwarded-for": xff, "content-type": "application/json" }, payload: "{}" });
  await app.close();
  return seen[0]?.["x-forwarded-for"];
};

describe("gateway trusts X-Forwarded-For only from internal peers", () => {
  it("from the (private) web tier, the forwarded client address is used", async () => {
    expect(await call("10.0.0.9", "203.0.113.7")).toBe("203.0.113.7");
  });
  it("from a public peer, a forged header is ignored and the socket address is forwarded", async () => {
    expect(await call("8.8.8.8", "203.0.113.7")).toBe("8.8.8.8");
  });
});
