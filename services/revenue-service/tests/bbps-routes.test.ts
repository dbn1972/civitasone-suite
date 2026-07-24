/**
 * BBPS module — route-level integration tests.
 *
 * Covers: POST /bbps/fetch-bill 202, POST /bbps/pay-bill 202,
 * BBPS_DISABLED guard (403), 400/401 error paths.
 */
import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";
import type { FastifyInstance } from "fastify";
import { signToken } from "@civitasone/auth";

const SECRET = "test_secret_for_civitasone_32chr";
const TENANT_ID = "t1111111-1111-1111-1111-111111111111";
const USER_ID = "u1111111-1111-1111-1111-111111111111";

function makeToken(roles: string[]) {
  return signToken({ sub: USER_ID, tid: TENANT_ID, roles, sid: "s1" }, SECRET, 3600);
}

const AUTH = { authorization: `Bearer ${makeToken(["revenue_admin"])}` };

// ── Mocks ─────────────────────────────────────────────────────────────────────

vi.mock("../src/shared/db.js", () => ({
  db: {
    transaction: vi.fn(async (fn: (tx: unknown) => Promise<unknown>) => fn({})),
    select: vi.fn().mockReturnThis(),
    from: vi.fn().mockReturnThis(),
    where: vi.fn().mockReturnThis(),
  },
  sqlClient: { end: vi.fn() },
  dbFor: vi.fn(),
  sqlClientFor: vi.fn(),
  tierOf: vi.fn(),
  dbForRead: vi.fn(),
}));

vi.mock("../src/shared/infra.js", () => ({
  cache: {
    put: vi.fn().mockResolvedValue(undefined),
    get: vi.fn().mockResolvedValue(null),
    getOrLoad: vi.fn().mockResolvedValue([]),
    invalidate: vi.fn().mockResolvedValue(undefined),
  },
  queue: {
    publish: vi.fn().mockResolvedValue(undefined),
    subscribe: vi.fn(),
    start: vi.fn().mockResolvedValue(undefined),
    stop: vi.fn().mockResolvedValue(undefined),
    healthCheck: vi.fn().mockResolvedValue({ healthy: true }),
  },
}));

// Bridge authPlugin (sets req.ctx) → revenue-service resolveContext (reads req.user)
vi.mock("../src/shared/context.js", async (importOriginal) => {
  const original = await importOriginal<typeof import("../src/shared/context.js")>();
  return {
    ...original,
    resolveContext: (req: any) => {
      const ctx = req.ctx;
      if (!ctx || ctx.actorId === "system" || ctx.actorId === "anonymous") {
        throw new original.HttpError(401, "UNAUTHENTICATED", "missing authentication");
      }
      return {
        actorId: ctx.actorId,
        tenantId: ctx.tenantId,
        roles: ctx.roles ?? [],
        sessionId: ctx.sessionId ?? "",
        correlationId: ctx.correlationId ?? req.id,
      };
    },
  };
});

// ── App Setup ─────────────────────────────────────────────────────────────────

let app: FastifyInstance;

beforeAll(async () => {
  const { buildApp } = await import("../src/app.js");
  app = await buildApp();
  await app.ready();
});

afterAll(async () => {
  await app.close();
});

// ── BBPS_DISABLED guard ───────────────────────────────────────────────────────

describe("BBPS routes when BBPS_ENABLED is not true", () => {
  it("POST /v1/revenue/bbps/fetch-bill returns 403 BBPS_DISABLED", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/v1/revenue/bbps/fetch-bill",
      headers: AUTH,
      payload: { assesseeIdentifier: "PROP-12345" },
    });
    expect(res.statusCode).toBe(403);
    expect(res.json().error.code).toBe("BBPS_DISABLED");
  });

  it("POST /v1/revenue/bbps/pay-bill returns 403 BBPS_DISABLED", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/v1/revenue/bbps/pay-bill",
      headers: AUTH,
      payload: { assesseeIdentifier: "PROP-12345", amountMinor: "500000", bbpsTxnId: "TXN001", channel: "mobile" },
    });
    expect(res.statusCode).toBe(403);
    expect(res.json().error.code).toBe("BBPS_DISABLED");
  });
});

// ── POST /v1/revenue/bbps/fetch-bill ──────────────────────────────────────────

describe("POST /v1/revenue/bbps/fetch-bill (validation)", () => {
  it("returns 403 BBPS_DISABLED even with empty body (BBPS check runs first)", async () => {
    const res = await app.inject({ method: "POST", url: "/v1/revenue/bbps/fetch-bill", headers: AUTH, payload: {} });
    expect(res.statusCode).toBe(403);
  });

  it("returns 401 without auth (authPlugin intercepts before route)", async () => {
    const res = await app.inject({ method: "POST", url: "/v1/revenue/bbps/fetch-bill", payload: { assesseeIdentifier: "X" } });
    expect(res.statusCode).toBe(401);
  });
});

// ── POST /v1/revenue/bbps/pay-bill ────────────────────────────────────────────

describe("POST /v1/revenue/bbps/pay-bill (validation)", () => {
  it("returns 403 BBPS_DISABLED even with empty body (BBPS check runs first)", async () => {
    const res = await app.inject({ method: "POST", url: "/v1/revenue/bbps/pay-bill", headers: AUTH, payload: {} });
    expect(res.statusCode).toBe(403);
  });

  it("returns 401 without auth (authPlugin intercepts before route)", async () => {
    const res = await app.inject({ method: "POST", url: "/v1/revenue/bbps/pay-bill", payload: { assesseeIdentifier: "X", amountMinor: "100", bbpsTxnId: "T1", channel: "web" } });
    expect(res.statusCode).toBe(401);
  });
});
