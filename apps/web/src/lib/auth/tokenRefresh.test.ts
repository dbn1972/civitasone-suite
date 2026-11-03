import { describe, it, expect, vi, beforeEach } from "vitest";
import { refreshAccessToken } from "@civitasone/client-core";
import { __resetRefreshFlightsForTests, endKeycloakSession, refreshTokensOnce, REFRESH_GRACE_MS } from "./tokenRefresh";

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

  it("treats network errors and 5xx as transient and does not cache them (next call retries)", async () => {
    vi.mocked(refreshAccessToken)
      .mockRejectedValueOnce(new TypeError("fetch failed"))
      .mockRejectedValueOnce(new Error("TOKEN_REFRESH_FAILED: 503"))
      .mockResolvedValueOnce(TOKENS);
    expect(await refreshTokensOnce("rt-x")).toEqual({ ok: false, reason: "unavailable" });
    expect(await refreshTokensOnce("rt-x")).toEqual({ ok: false, reason: "unavailable" });
    expect(await refreshTokensOnce("rt-x")).toEqual({ ok: true, tokens: TOKENS });
    expect(refreshAccessToken).toHaveBeenCalledTimes(3);
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
