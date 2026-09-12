import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { fetchBills } from "./client";

/**
 * UX-016: works/_data/client.ts's readError() used to fall back to
 * `Request failed (${res.status})` (and, even in the non-fallback path,
 * passed the raw server `message`/`code`/body text straight through) — the
 * same class of leak useFormError closes fleet-wide for components (UX-003).
 * This module is a plain async data-fetching client (not a component), so
 * it can't use that hook; it now goes through the same catalogued
 * `toHumanError` vocabulary instead and never reads the response body at
 * all, so it structurally cannot leak it.
 */
describe("works/_data/client — readError never leaks raw status or server text", () => {
  const fetchMock = vi.fn();

  beforeEach(() => {
    fetchMock.mockReset();
    vi.stubGlobal("fetch", fetchMock);
  });

  afterEach(() => vi.unstubAllGlobals());

  it("throws a clerk-safe message, never the raw HTTP status, on a failed read", async () => {
    fetchMock.mockResolvedValue(new Response("", { status: 503 }));

    const err = await fetchBills().catch((e: unknown) => e);
    expect(err).toBeInstanceOf(Error);
    const message = (err as Error).message;
    expect(message).not.toMatch(/\b503\b/);
    expect(message).toMatch(/couldn't load/i);
  });

  it("never surfaces raw server response text, even when the body carries a message/code", async () => {
    fetchMock.mockResolvedValue(
      new Response(JSON.stringify({ code: "UPSTREAM_DOWN", message: "works-service circuit open" }), {
        status: 502,
        headers: { "content-type": "application/json" },
      }),
    );

    const err = await fetchBills().catch((e: unknown) => e);
    const message = (err as Error).message;
    expect(message).not.toContain("works-service circuit open");
    expect(message).not.toContain("UPSTREAM_DOWN");
    expect(message).not.toMatch(/\b502\b/);
  });

  it("resolves normally and unwraps `data` on success", async () => {
    fetchMock.mockResolvedValue(
      new Response(JSON.stringify({ data: [{ id: "b1" }] }), {
        status: 200,
        headers: { "content-type": "application/json" },
      }),
    );

    const rows = await fetchBills();
    expect(rows).toEqual([{ id: "b1" }]);
  });
});
