/**
 * SECURITY FIX — httpProbe no longer auto-follows HTTP redirects.
 *
 * PROPERTY: `httpProbe` must not transparently dial a redirect target that
 * the SSRF guard would have rejected as the original URL. Every hop of a
 * redirect chain is re-checked against the SAME guard before being fetched,
 * `fetch` is called with `redirect: "manual"` so Node never follows a
 * Location header on our behalf, and the chain is bounded so it can't loop
 * forever.
 *
 * All test targets are bare IP literals (never hostnames) so the guard's
 * string-based check applies with no DNS resolution involved — these tests
 * run fully offline and deterministically.
 */
import { describe, it, expect, vi, afterEach } from "vitest";
import { httpProbe } from "../src/modules/integration-settings/providers.js";

function mockResponse(init: { status: number; headers?: Record<string, string>; ok?: boolean; text?: string }) {
  const headers = new Headers(init.headers ?? {});
  return {
    status: init.status,
    ok: init.ok ?? (init.status >= 200 && init.status < 300),
    headers,
    text: async () => init.text ?? "",
  } as unknown as Response;
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("httpProbe — redirect targets are re-checked by the SSRF guard, never auto-followed", () => {
  it("blocks a redirect to the cloud metadata IP and never dials it", async () => {
    const fetchMock = vi.fn().mockResolvedValueOnce(
      mockResponse({ status: 302, headers: { location: "http://169.254.169.254/latest/meta-data/" } })
    );
    vi.stubGlobal("fetch", fetchMock);

    const result = await httpProbe("http://93.184.216.34/", {});

    expect(result).toEqual({ status: "failed", ok: false, error: "SSRF_BLOCKED: destination not allowed" });
    // The blocked redirect target must NEVER be fetched — only the original
    // (allowed) URL's single request happens.
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock).toHaveBeenCalledWith("http://93.184.216.34/", expect.objectContaining({ redirect: "manual" }));
  });

  it("blocks a redirect to an IPv4-mapped-IPv6 loopback address (both fixes composed)", async () => {
    const fetchMock = vi.fn().mockResolvedValueOnce(
      mockResponse({ status: 302, headers: { location: "http://[::ffff:127.0.0.1]/" } })
    );
    vi.stubGlobal("fetch", fetchMock);

    const result = await httpProbe("http://93.184.216.34/", {});

    expect(result.ok).toBe(false);
    expect(result.error).toBe("SSRF_BLOCKED: destination not allowed");
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("follows a legitimate redirect chain between two allowed public destinations", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(mockResponse({ status: 301, headers: { location: "http://8.8.8.8/final" } }))
      .mockResolvedValueOnce(mockResponse({ status: 200 }));
    vi.stubGlobal("fetch", fetchMock);

    const result = await httpProbe("http://93.184.216.34/", {});

    expect(result).toEqual({ status: "connected", ok: true, detail: "HTTP 200" });
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(fetchMock).toHaveBeenNthCalledWith(1, "http://93.184.216.34/", expect.objectContaining({ redirect: "manual" }));
    expect(fetchMock).toHaveBeenNthCalledWith(2, "http://8.8.8.8/final", expect.objectContaining({ redirect: "manual" }));
  });

  it("resolves a relative Location header against the current hop, not the original URL", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(mockResponse({ status: 302, headers: { location: "/moved" } }))
      .mockResolvedValueOnce(mockResponse({ status: 200 }));
    vi.stubGlobal("fetch", fetchMock);

    const result = await httpProbe("http://93.184.216.34/start", {});

    expect(result.ok).toBe(true);
    expect(fetchMock).toHaveBeenNthCalledWith(2, "http://93.184.216.34/moved", expect.objectContaining({ redirect: "manual" }));
  });

  it("gives up after a bounded number of redirect hops instead of looping forever", async () => {
    const fetchMock = vi.fn().mockImplementation(async (url: string) => {
      // Each hop points at a different allowed public IP so the guard never
      // rejects a hop directly — only the hop-count bound should stop this.
      const n = Number(new URL(url).pathname.slice(1) || "0");
      return mockResponse({ status: 302, headers: { location: `http://93.184.216.34/${n + 1}` } });
    });
    vi.stubGlobal("fetch", fetchMock);

    const result = await httpProbe("http://93.184.216.34/0", {});

    expect(result.ok).toBe(false);
    expect(result.error).toBe("SSRF_BLOCKED: too many redirects");
    // Bounded, not unbounded: a small, fixed number of hops is attempted.
    expect(fetchMock.mock.calls.length).toBeLessThanOrEqual(10);
    expect(fetchMock.mock.calls.length).toBeGreaterThan(1);
  });

  it("still blocks a destination that is blocked on the very first hop (no redirect involved)", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);

    const result = await httpProbe("http://169.254.169.254/", {});

    expect(result).toEqual({ status: "failed", ok: false, error: "SSRF_BLOCKED: destination not allowed" });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("still returns the real HTTP status for a non-redirecting allowed destination", async () => {
    const fetchMock = vi.fn().mockResolvedValueOnce(mockResponse({ status: 200 }));
    vi.stubGlobal("fetch", fetchMock);

    const result = await httpProbe("http://93.184.216.34/", {});

    expect(result).toEqual({ status: "connected", ok: true, detail: "HTTP 200" });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});
