/**
 * GET /v1/finance/traces/pan-status/:pan follows the finance PAN convention (masters/routes.ts):
 * uppercase the input, then require AAAAA9999A. A lowercase PAN is normalised before it is sent
 * to TRACES (never forwarded as typed); a malformed PAN is a 400 and never reaches TRACES.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { signToken } from "@civitasone/auth";

const JWT_SECRET = process.env.JWT_SECRET as string; // set by vitest.config.ts
const token = () => signToken({ sub: "00000000-aaaa-4000-8000-0000000000f1", tid: "11111111-aaaa-4000-8000-0000000000f1", roles: ["finance_admin"], sid: "sess-pan" }, JWT_SECRET, 3600);

describe("TRACES pan-status PAN normalisation", () => {
  beforeEach(() => {
    vi.resetModules();
    vi.stubEnv("TRACES_ENABLED", "true");
    vi.stubEnv("TRACES_BASE_URL", "https://traces.example.com");
    vi.stubEnv("TRACES_API_KEY", "test-api-key");
    vi.stubEnv("JWT_SECRET", JWT_SECRET);
  });
  afterEach(() => { vi.unstubAllEnvs(); vi.unstubAllGlobals(); vi.restoreAllMocks(); });

  it("a lowercase PAN is uppercased before the TRACES call", async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({ pan: "ABCDE1234F", status: "valid", lastVerifiedAt: "2026-07-10T10:00:00Z" }),
    });
    vi.stubGlobal("fetch", fetchMock);
    const { buildApp } = await import("../src/app.js");
    const app = await buildApp();
    const res = await app.inject({ method: "GET", url: "/v1/finance/traces/pan-status/abcde1234f", headers: { authorization: `Bearer ${token()}` } });
    expect(res.statusCode).toBe(200);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const calledUrl = String(fetchMock.mock.calls[0]![0]);
    expect(calledUrl).toContain("ABCDE1234F");
    expect(calledUrl).not.toContain("abcde1234f");
    await app.close();
  });

  for (const bad of ["abcd11234f", "ABCDE12345", "not-a-uuid", "ABCDE1234"]) {
    it(`malformed PAN ${bad} -> 400, TRACES never called`, async () => {
      const fetchMock = vi.fn();
      vi.stubGlobal("fetch", fetchMock);
      const { buildApp } = await import("../src/app.js");
      const app = await buildApp();
      const res = await app.inject({ method: "GET", url: `/v1/finance/traces/pan-status/${bad}`, headers: { authorization: `Bearer ${token()}` } });
      expect(res.statusCode).toBe(400);
      expect(res.json().code).toBe("VALIDATION_FAILED");
      expect(fetchMock).not.toHaveBeenCalled();
      await app.close();
    });
  }
});
