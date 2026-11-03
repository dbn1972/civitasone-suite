import { describe, it, expect, vi, beforeEach } from "vitest";
import { refreshAccessToken } from "@civitasone/client-core";
import {
  __refreshFlightCountForTests,
  __resetRefreshFlightsForTests,
  endKeycloakSession,
  forgetRefreshToken,
  refreshTokensOnce,
  REFRESH_GRACE_MS,
  UNAVAILABLE_TTL_MS,
} from "./tokenRefresh";

vi.mock("@civitasone/client-core", () => ({ refreshAccessToken: vi.fn() }));

const TOKENS = { access_token: "new-at", refresh_token: "new-rt", expires_in: 1800, refresh_expires_in: 1800, token_type: "Bearer" };

describe("refreshTokensOnce (A11Y-01 silent refresh)", () => {
  beforeEach(() => {
    __resetRefreshFlightsForTests();
    vi.mocked(refreshAccessToken).mockReset();
  });

  it("returns Keycloak's new tokens on success, using the civitasone-web client", async () => {
    vi.mocked(refreshAccessToken).mockResolvedValue(TOKENS);
    const out = await refreshTokensOnce("rt-1");
    expect(out).toEqual({ ok: true, tokens: TOKENS });
    expect(refreshAccessToken).toHaveBeenCalledTimes(1);
    const [config, rt] = vi.mocked(refreshAccessToken).mock.calls[0]!;
    expect(config.clientId).toBe("civitasone-web");
    expect(rt).toBe("rt-1");
  });

  it("is single-flight: concurrent refreshes of one refresh token make ONE Keycloak call (rotation + reuse detection)", async () => {
    let resolve!: (v: typeof TOKENS) => void;
    vi.mocked(refreshAccessToken).mockReturnValue(new Promise((r) => { resolve = r; }));
    const calls = Array.from({ length: 5 }, () => refreshTokensOnce("rt-shared"));
    await vi.waitFor(() => expect(refreshAccessToken).toHaveBeenCalledTimes(1));
    resolve(TOKENS);
    const outs = await Promise.all(calls);
    expect(refreshAccessToken).toHaveBeenCalledTimes(1);
    for (const o of outs) expect(o).toEqual({ ok: true, tokens: TOKENS });
  });

  it("reuses a settled outcome for requests still carrying the old token within the grace window, then forgets it", async () => {
    let now = 1_000_000;
    vi.mocked(refreshAccessToken).mockResolvedValue(TOKENS);
    await refreshTokensOnce("rt-old", () => now);
    now += REFRESH_GRACE_MS - 1;
    expect(await refreshTokensOnce("rt-old", () => now)).toEqual({ ok: true, tokens: TOKENS });
    expect(refreshAccessToken).toHaveBeenCalledTimes(1);
    now += 2;
    await refreshTokensOnce("rt-old", () => now);
    expect(refreshAccessToken).toHaveBeenCalledTimes(2);
  });

  it("does not share flights between different refresh tokens", async () => {
    vi.mocked(refreshAccessToken).mockResolvedValue(TOKENS);
    await Promise.all([refreshTokensOnce("rt-a"), refreshTokensOnce("rt-b")]);
    expect(refreshAccessToken).toHaveBeenCalledTimes(2);
  });

  it.each(["400", "401"])("classifies a Keycloak %s (expired / revoked / replayed token) as invalid -> sign out", async (status) => {
    vi.mocked(refreshAccessToken).mockRejectedValue(new Error(`TOKEN_REFRESH_FAILED: ${status}`));
    expect(await refreshTokensOnce("rt-dead")).toEqual({ ok: false, reason: "invalid" });
  });

  it("negative-caches 'Keycloak unavailable' briefly (an outage must not make every request wait the timeout), then retries", async () => {
    let now = 5_000_000;
    vi.mocked(refreshAccessToken)
      .mockRejectedValueOnce(new TypeError("fetch failed"))
      .mockRejectedValueOnce(new Error("TOKEN_REFRESH_FAILED: 503"))
      .mockResolvedValueOnce(TOKENS);
    expect(await refreshTokensOnce("rt-x", () => now)).toEqual({ ok: false, reason: "unavailable" });
    // within the negative TTL: served from cache, no new Keycloak call
    now += UNAVAILABLE_TTL_MS - 1;
    expect(await refreshTokensOnce("rt-x", () => now)).toEqual({ ok: false, reason: "unavailable" });
    expect(refreshAccessToken).toHaveBeenCalledTimes(1);
    // after it: retried (and a 5xx is equally transient)
    now += 2;
    expect(await refreshTokensOnce("rt-x", () => now)).toEqual({ ok: false, reason: "unavailable" });
    now += UNAVAILABLE_TTL_MS + 1;
    expect(await refreshTokensOnce("rt-x", () => now)).toEqual({ ok: true, tokens: TOKENS });
    expect(refreshAccessToken).toHaveBeenCalledTimes(3);
  });

  it("keeps single-flight during an outage: concurrent callers share the one failing call", async () => {
    vi.mocked(refreshAccessToken).mockImplementation(() => new Promise((_, rej) => setTimeout(() => rej(new TypeError("timeout")), 5)));
    const outs = await Promise.all(Array.from({ length: 4 }, () => refreshTokensOnce("rt-down")));
    expect(refreshAccessToken).toHaveBeenCalledTimes(1);
    for (const o of outs) expect(o).toEqual({ ok: false, reason: "unavailable" });
  });

  it("uses a short (15 s) grace window for rotated tokens, and the negative TTL is shorter still", () => {
    expect(REFRESH_GRACE_MS).toBe(15_000);
    expect(UNAVAILABLE_TTL_MS).toBeGreaterThanOrEqual(5_000);
    expect(UNAVAILABLE_TTL_MS).toBeLessThanOrEqual(10_000);
  });

  it("treats a malformed token response as transient", async () => {
    vi.mocked(refreshAccessToken).mockResolvedValue({} as typeof TOKENS);
    expect(await refreshTokensOnce("rt-y")).toEqual({ ok: false, reason: "unavailable" });
  });
});

describe("endKeycloakSession", () => {
  it("POSTs client_id + refresh_token to Keycloak's logout endpoint and never throws", async () => {
    const fetchMock = vi.fn().mockRejectedValue(new TypeError("down"));
    vi.stubGlobal("fetch", fetchMock);
    await expect(endKeycloakSession("rt-z")).resolves.toBeUndefined();
    const [url, init] = fetchMock.mock.calls[0]!;
    expect(String(url)).toMatch(/\/protocol\/openid-connect\/logout$/);
    expect(init.method).toBe("POST");
    const body = new URLSearchParams(String(init.body));
    expect(body.get("client_id")).toBe("civitasone-web");
    expect(body.get("refresh_token")).toBe("rt-z");
    vi.unstubAllGlobals();
  });

  it("does nothing without a refresh token", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    await endKeycloakSession(undefined);
    expect(fetchMock).not.toHaveBeenCalled();
    vi.unstubAllGlobals();
  });
});

describe("forgetRefreshToken (sign-out)", () => {
  beforeEach(() => {
    __resetRefreshFlightsForTests();
    vi.mocked(refreshAccessToken).mockReset();
  });

  it("drops the pre-rotation entry so the rotated token cannot be replayed from cache after sign-out", async () => {
    vi.mocked(refreshAccessToken).mockResolvedValue(TOKENS); // rotates rt-old -> new-rt
    await refreshTokensOnce("rt-old");
    expect(__refreshFlightCountForTests()).toBe(1);
    // the browser now holds new-rt; signing out with it clears the rt-old entry
    await forgetRefreshToken("new-rt");
    expect(__refreshFlightCountForTests()).toBe(0);
    await refreshTokensOnce("rt-old");
    expect(refreshAccessToken).toHaveBeenCalledTimes(2); // went to Keycloak, which rejects a replay
  });

  it("drops the entry keyed by the current token too, and leaves other sessions' entries alone", async () => {
    vi.mocked(refreshAccessToken).mockRejectedValue(new Error("TOKEN_REFRESH_FAILED: 400"));
    await refreshTokensOnce("rt-mine");
    await refreshTokensOnce("rt-other");
    await forgetRefreshToken("rt-mine");
    expect(__refreshFlightCountForTests()).toBe(1);
  });

  it("drops a flight that is still running as soon as it settles", async () => {
    let resolve!: (v: typeof TOKENS) => void;
    vi.mocked(refreshAccessToken).mockReturnValue(new Promise((r) => { resolve = r; }));
    const pending = refreshTokensOnce("rt-busy");
    await vi.waitFor(() => expect(refreshAccessToken).toHaveBeenCalledTimes(1));
    await forgetRefreshToken("rt-busy");
    resolve(TOKENS);
    await pending;
    expect(__refreshFlightCountForTests()).toBe(0);
  });

  it("is a no-op without a token", async () => {
    await expect(forgetRefreshToken(undefined)).resolves.toBeUndefined();
  });
});
