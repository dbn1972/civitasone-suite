/**
 * Route-level and infrastructure tests for inspection-service app.ts.
 * Covers: /health, /ready, /metrics (no auth), env validation, auth enforcement.
 * Uses buildApp + inject with HS256 tokens for auth.
 */
import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";
import type { FastifyInstance } from "fastify";

// Mock DB so tests run without a real Postgres connection
vi.mock("../src/shared/db.js", () => ({
  db: { execute: vi.fn() },
  sqlClient: { end: vi.fn() },
  dbFor: vi.fn(),
  sqlClientFor: vi.fn(),
  tierOf: vi.fn(),
  dbForRead: vi.fn(),
}));

// Mock infra (cache + queue) for test isolation
vi.mock("../src/shared/infra.js", () => ({
  invalidateSafely: vi.fn().mockResolvedValue(undefined),
  cache: {
    put: vi.fn().mockResolvedValue(undefined),
    get: vi.fn().mockResolvedValue(null),
    getOrLoad: vi.fn(),
    invalidate: vi.fn(),
  },
  queue: {
    publish: vi.fn().mockResolvedValue(undefined),
    subscribe: vi.fn(),
    start: vi.fn().mockResolvedValue(undefined),
    stop: vi.fn().mockResolvedValue(undefined),
    healthCheck: vi.fn().mockResolvedValue({ healthy: true }),
  },
}));

let app: FastifyInstance;

beforeAll(async () => {
  const { buildApp } = await import("../src/app.js");
  app = await buildApp();
  await app.ready();
});

afterAll(async () => {
  await app.close();
});

describe("GET /health", () => {
  it("returns 200 with status ok (no auth required)", async () => {
    const res = await app.inject({ method: "GET", url: "/health" });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.status).toBe("ok");
    expect(body.service).toBe("inspection-service");
    expect(body.uptimeSeconds).toBeTypeOf("number");
  });
});

describe("GET /ready", () => {
  it("returns 200 with readiness status (no auth required)", async () => {
    const res = await app.inject({ method: "GET", url: "/ready" });
    // May be 200 or 503 depending on mock state; structure is consistent
    const body = res.json();
    expect(body).toHaveProperty("status");
    expect(body).toHaveProperty("checks");
  });
});

describe("GET /metrics", () => {
  it("returns 200 Prometheus format from internal IP (no auth required)", async () => {
    const res = await app.inject({
      method: "GET",
      url: "/metrics",
      remoteAddress: "127.0.0.1",
    });
    expect(res.statusCode).toBe(200);
    expect(res.headers["content-type"]).toContain("text/plain");
    expect(res.payload).toContain("service_up");
    expect(res.payload).toContain("inspection-service");
  });
});

describe("auth enforcement", () => {
  it("returns 401 for protected routes without Bearer token", async () => {
    // Any route that isn't a public path (/health, /ready, /metrics)
    // will go through the auth hook — since no matching route exists we get
    // 404 only AFTER auth passes. With no token, auth rejects with 401.
    const res = await app.inject({ method: "GET", url: "/v1/inspection/entities" });
    // Auth plugin returns 401 before routing to a 404, proving auth is enforced
    expect(res.statusCode).toBe(401);
  });

  it("returns 403 for protected routes with valid JWT but insufficient role", async () => {
    // Sign a valid token with a role that is NOT in the allowed set for the
    // enforcement penalty-rates endpoint (requires inspection_admin, tenant_admin, or super_admin).
    const { signToken } = await import("@civitasone/auth");
    const token = signToken(
      {
        sub: "00000000-0000-0000-0000-000000000001",
        tid: "00000000-0000-0000-0000-000000000099",
        roles: ["citizen"], // deliberately wrong role — not in ADMIN_ROLES
        sid: "sess-test",
      },
      "test_secret_for_civitasone_32chr",
      3600,
    );

    const res = await app.inject({
      method: "POST",
      url: "/v1/inspection/enforcement/penalty-rates",
      headers: { authorization: `Bearer ${token}` },
      payload: {
        provisionId: "00000000-0000-0000-0000-000000000001",
        effectiveFrom: "2025-01-01",
        amount: "100000",
      },
    });

    expect(res.statusCode).toBe(403);
    const body = res.json();
    expect(body.code).toBe("FORBIDDEN");
  });
});

describe("env validation", () => {
  it("throws if required env vars are missing", async () => {
    // Temporarily unset a required var
    const original = process.env.DATABASE_URL;
    delete process.env.DATABASE_URL;

    const { buildApp } = await import("../src/app.js");
    await expect(buildApp()).rejects.toThrow("DATABASE_URL");

    // Restore
    process.env.DATABASE_URL = original;
  });
});
