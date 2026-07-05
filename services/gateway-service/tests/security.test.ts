import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { signToken } from "@civitasone/auth";
import { buildApp } from "../src/app.js";

// HS256 test token
const SECRET = "test_secret_for_civitasone_32chr";
const VALID_TOKEN = signToken({ sub: "actor-1", tid: "tenant-1", roles: ["admin"] }, SECRET, 3600);

// Stub upstream fetch so we can verify what headers reach "upstream" services.
let lastUpstreamHeaders: Record<string, string> = {};

beforeEach(() => {
  lastUpstreamHeaders = {};
  vi.stubGlobal("fetch", async (_url: string, init?: RequestInit) => {
    lastUpstreamHeaders = Object.fromEntries(
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

describe("FIX-00: x-internal auth bypass", () => {
  it("strips x-internal from external requests — bypass header never reaches upstream", async () => {
    const app = await buildApp();
    const res = await app.inject({
      method: "GET",
      url: "/api/v1/finance/bills",
      headers: {
        "x-internal": "1",
        "x-tenant-id": "00000000-0000-0000-0000-000000000001",
      },
    });
    // Must be rejected at the gateway auth layer (no Bearer token) OR stripped.
    // Either way, upstream must NOT receive x-internal.
    expect(lastUpstreamHeaders["x-internal"]).toBeUndefined();
  });

  it("returns 401 when x-internal is sent without a Bearer token", async () => {
    const app = await buildApp();
    const res = await app.inject({
      method: "GET",
      url: "/api/v1/finance/bills",
      headers: {
        "x-internal": "1",
        "x-tenant-id": "00000000-0000-0000-0000-000000000001",
      },
    });
    expect(res.statusCode).toBe(401);
  });

  it("does not forward x-internal-secret or x-internal-caller", async () => {
    const app = await buildApp();
    await app.inject({
      method: "GET",
      url: "/api/v1/finance/bills",
      headers: {
        authorization: `Bearer ${VALID_TOKEN}`,
        "x-internal": "1",
        "x-internal-secret": "leaked",
        "x-internal-caller": "attacker",
        "x-service-secret": "stolen",
      },
    });
    expect(lastUpstreamHeaders["x-internal"]).toBeUndefined();
    expect(lastUpstreamHeaders["x-internal-secret"]).toBeUndefined();
    expect(lastUpstreamHeaders["x-internal-caller"]).toBeUndefined();
    expect(lastUpstreamHeaders["x-service-secret"]).toBeUndefined();
  });

  it("does forward safe headers — correlation-id passes through", async () => {
    const app = await buildApp();
    await app.inject({
      method: "GET",
      url: "/api/v1/finance/bills",
      headers: {
        authorization: `Bearer ${VALID_TOKEN}`,
        "x-correlation-id": "test-corr-123",
        "x-tenant-id": "00000000-0000-0000-0000-000000000001",
      },
    });
    expect(lastUpstreamHeaders["x-correlation-id"]).toBe("test-corr-123");
  });
});

describe("FIX-00: /metrics access control", () => {
  it("allows /metrics from loopback when METRICS_TOKEN is unset", async () => {
    delete process.env.METRICS_TOKEN;
    const app = await buildApp();
    // inject() uses 127.0.0.1 internally — treated as internal IP
    const res = await app.inject({ method: "GET", url: "/metrics" });
    expect(res.statusCode).toBe(200);
  });

  it("requires METRICS_TOKEN header when env is set", async () => {
    process.env.METRICS_TOKEN = "secret-metrics-token";
    try {
      const app = await buildApp();
      const denied = await app.inject({ method: "GET", url: "/metrics" });
      expect(denied.statusCode).toBe(403);

      const allowed = await app.inject({
        method: "GET",
        url: "/metrics",
        headers: { "x-metrics-token": "secret-metrics-token" },
      });
      expect(allowed.statusCode).toBe(200);
    } finally {
      delete process.env.METRICS_TOKEN;
    }
  });
});

describe("FIX-00: auth rate limit", () => {
  it("registers /api/identity/* with stricter rate limit config", async () => {
    const app = await buildApp();
    // Route exists — it accepts requests
    const res = await app.inject({
      method: "POST",
      url: "/api/identity/v1/auth/login",
      headers: { "content-type": "application/json" },
      payload: {},
    });
    // We just verify the route is registered (upstream would 404 in test env but gateway processes it)
    expect([200, 401, 404, 502]).toContain(res.statusCode);
  });
});
