/**
 * CLOS2-S6-11 — token endpoint calls must be time-bounded and must not leak the
 * response body into the thrown error (it reaches UI error handlers).
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { exchangeAuthorizationCode, refreshAccessToken } from "../src/pkce.js";

const cfg = { issuerUrl: "https://kc.invalid/realms/r/", clientId: "c", redirectUri: "https://app.invalid/cb" };

afterEach(() => vi.unstubAllGlobals());

const calls: Array<[string, () => Promise<unknown>]> = [
  ["exchangeAuthorizationCode", () => exchangeAuthorizationCode(cfg, "code", "verifier")],
  ["refreshAccessToken", () => refreshAccessToken(cfg, "rt")],
];

describe("pkce token endpoint fetches", () => {
  for (const [name, run] of calls) {
    it(`${name} passes an AbortSignal to fetch`, async () => {
      const f = vi.fn(async () => new Response(JSON.stringify({ access_token: "x" }), { status: 200 }));
      vi.stubGlobal("fetch", f);
      await run();
      expect((f.mock.calls[0] as unknown as [string, RequestInit])[1].signal).toBeInstanceOf(AbortSignal);
    });

    it(`${name} rejects when fetch rejects with a TimeoutError`, async () => {
      vi.stubGlobal("fetch", vi.fn(async () => { throw new DOMException("timed out", "TimeoutError"); }));
      await expect(run()).rejects.toMatchObject({ name: "TimeoutError" });
    });
  }

  it("exchangeAuthorizationCode error carries only the status, not the response body", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response("secret-detail", { status: 400 })));
    const err = await exchangeAuthorizationCode(cfg, "code", "verifier").then(() => null, (e: Error) => e);
    expect(err?.message).toBe("TOKEN_EXCHANGE_FAILED: 400");
    expect(err?.message).not.toContain("secret-detail");
  });
});
