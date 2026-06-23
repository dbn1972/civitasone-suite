/**
 * Security test: X-Internal bypass closed
 *
 * Verifies that the gateway strips X-Internal headers from external requests
 * and returns 401 when no valid Bearer token is provided — even if the client
 * sends X-Internal: 1 to try to impersonate an internal service-to-service call.
 *
 * Uses gateway's buildApp() with a stubbed upstream fetch (no live services needed).
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { buildApp } from "../../services/gateway-service/src/app.js";

let capturedHeaders: Record<string, string> = {};

beforeEach(() => {
  capturedHeaders = {};
  vi.stubGlobal("fetch", async (_url: string, init?: RequestInit) => {
    capturedHeaders = Object.fromEntries(
      Object.entries((init?.headers as Record<string, string>) ?? {}),
    );
    return new Response(JSON.stringify({ ok: true }), {
      status: 200,
      headers: { "content-type": "application/json" },
    });
  });
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("Security: X-Internal bypass must be closed at the gateway", () => {
  it("returns 401 when X-Internal is sent without a Bearer token", async () => {
    const app = await buildApp();
    const res = await app.inject({
      method: "GET",
      url: "/api/v1/finance/bills",
      headers: {
        "x-internal": "1",
        "x-tenant-id": "00000000-0000-0000-0000-000000000001",
      },
    });
    // Request must be rejected — no internal bypass
    expect(res.statusCode).toBe(401);
    await app.close();
  });

  it("never forwards X-Internal header to upstream regardless of auth status", async () => {
    const app = await buildApp();
    // Send with a Bearer (even non-valid) to reach the upstream proxy — verify header is stripped
    await app.inject({
      method: "GET",
      url: "/api/v1/finance/bills",
      headers: {
        authorization: "Bearer fake-token-for-header-strip-test",
        "x-internal": "1",
        "x-tenant-id": "00000000-0000-0000-0000-000000000001",
      },
    });
    expect(capturedHeaders["x-internal"]).toBeUndefined();
    await app.close();
  });

  it("never forwards X-Internal-Secret to upstream", async () => {
    const app = await buildApp();
    await app.inject({
      method: "GET",
      url: "/api/v1/finance/bills",
      headers: {
        authorization: "Bearer fake-token",
        "x-internal": "1",
        "x-internal-secret": "leaked-secret",
        "x-internal-caller": "attacker-service",
        "x-service-secret": "stolen-key",
      },
    });
    expect(capturedHeaders["x-internal"]).toBeUndefined();
    expect(capturedHeaders["x-internal-secret"]).toBeUndefined();
    expect(capturedHeaders["x-internal-caller"]).toBeUndefined();
    expect(capturedHeaders["x-service-secret"]).toBeUndefined();
    await app.close();
  });

  it("unauthenticated request with X-Internal on finance route → 401 (not 200)", async () => {
    const app = await buildApp();
    const res = await app.inject({
      method: "GET",
      url: "/api/v1/finance/sanctions",
      headers: { "x-internal": "1" },
    });
    expect(res.statusCode).toBe(401);
    await app.close();
  });

  it("unauthenticated request with X-Internal on HRMS route → 401", async () => {
    const app = await buildApp();
    const res = await app.inject({
      method: "GET",
      url: "/api/v1/hrms/employees",
      headers: { "x-internal": "1" },
    });
    expect(res.statusCode).toBe(401);
    await app.close();
  });
});
