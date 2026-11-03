import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import {
  __resetSessionClientForTests,
  fetchSessionTimes,
  refreshSession,
  sessionExpiredLoginUrl,
} from "./sessionClient";

const TIMES = { authenticated: true, accessExpiresAt: 1, sessionExpiresAt: 2, idleTimeoutSec: 1800, refreshable: true };

function json(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
}

describe("sessionClient (A11Y-01)", () => {
  const fetchMock = vi.fn();
  beforeEach(() => {
    __resetSessionClientForTests();
    fetchMock.mockReset();
    vi.stubGlobal("fetch", fetchMock);
  });
  afterEach(() => vi.unstubAllGlobals());

  it("refreshSession POSTs to /api/auth/refresh and returns the renewed timing", async () => {
    fetchMock.mockResolvedValue(json(200, TIMES));
    expect(await refreshSession()).toEqual({ ok: true, times: TIMES });
    const [url, init] = fetchMock.mock.calls[0]!;
    expect(url).toBe("/api/auth/refresh");
    expect(init).toMatchObject({ method: "POST", credentials: "same-origin" });
  });

  it("refreshSession is single-flight within a tab", async () => {
    let resolve!: (r: Response) => void;
    fetchMock.mockReturnValue(new Promise((r) => { resolve = r; }));
    const a = refreshSession();
    const b = refreshSession();
    expect(fetchMock).toHaveBeenCalledTimes(1);
    resolve(json(200, TIMES));
    expect(await a).toEqual(await b);
    // settled -> the next call is a new request
    fetchMock.mockResolvedValue(json(200, TIMES));
    await refreshSession();
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("reports expired on 401 (sign out) but not on 503 or a network error (retry)", async () => {
    fetchMock.mockResolvedValueOnce(json(401, { code: "SESSION_EXPIRED" }));
    expect(await refreshSession()).toEqual({ ok: false, expired: true });
    fetchMock.mockResolvedValueOnce(json(503, { code: "REFRESH_UNAVAILABLE" }));
    expect(await refreshSession()).toEqual({ ok: false, expired: false });
    fetchMock.mockRejectedValueOnce(new TypeError("offline"));
    expect(await refreshSession()).toEqual({ ok: false, expired: false });
  });

  it("fetchSessionTimes GETs timing and returns null on failure", async () => {
    fetchMock.mockResolvedValueOnce(json(200, TIMES));
    expect(await fetchSessionTimes()).toEqual(TIMES);
    fetchMock.mockRejectedValueOnce(new TypeError("offline"));
    expect(await fetchSessionTimes()).toBeNull();
  });

  it("builds the session-expired login URL with a same-origin return path only", () => {
    expect(sessionExpiredLoginUrl("/finance/journal/new?x=1")).toBe("/auth/login?error=session_expired&next=%2Ffinance%2Fjournal%2Fnew%3Fx%3D1");
    expect(sessionExpiredLoginUrl("//evil.example")).toBe("/auth/login?error=session_expired&next=%2Fdashboard");
  });
});
