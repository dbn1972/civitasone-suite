import { afterEach, describe, expect, it, vi } from "vitest";
import { persistSkippedStep, unskipStep } from "./setupSkipApi";

// Tenant-service registers the settings WRITE at PUT /v1/settings and the per-key READ at
// GET /v1/settings/:key (gateway prefix /api/v1/settings). /v1/tenant/settings has only a list GET.
describe("setupSkipApi wiring", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("reads the current list from /v1/settings/:key then PUTs the union to /v1/settings", async () => {
    const calls: Array<{ url: string; method: string; body?: string }> = [];
    vi.stubGlobal("fetch", vi.fn(async (url: string, init?: RequestInit) => {
      calls.push({ url, method: init?.method ?? "GET", body: init?.body as string | undefined });
      if (!init?.method) return new Response(JSON.stringify({ key: "setup.skipped_steps", value: ["branding"] }), { status: 200 });
      return new Response(JSON.stringify({ status: "accepted" }), { status: 202 });
    }));
    expect(await persistSkippedStep("holidays")).toBe(true);
    expect(calls[0].url).toBe("/api/proxy/v1/settings/setup.skipped_steps");
    expect(calls[1]).toMatchObject({ url: "/api/proxy/v1/settings", method: "PUT" });
    expect(JSON.parse(calls[1].body as string)).toEqual({ key: "setup.skipped_steps", value: ["branding", "holidays"] });
  });

  it("unskip removes the key and reports a rejected write honestly", async () => {
    vi.stubGlobal("fetch", vi.fn(async (_u: string, init?: RequestInit) => {
      if (!init?.method) return new Response(JSON.stringify({ value: ["branding", "holidays"] }), { status: 200 });
      return new Response("{}", { status: 403 });
    }));
    expect(await unskipStep("holidays")).toBe(false);
  });
});
