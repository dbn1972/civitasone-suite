/**
 * Rate Engine module — route-level integration tests.
 *
 * Covers: POST rate-heads/rate-slabs/penalty-rules/rebate-rules → 202,
 * GET rate-heads (paginated), 400 bad body, 401 no auth, 403 wrong role.
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
const BAD_ROLE = { authorization: `Bearer ${makeToken(["employee"])}` };

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

// ── POST /v1/revenue/rate-heads ───────────────────────────────────────────────

describe("POST /v1/revenue/rate-heads", () => {
  const VALID_BODY = { code: "PT", name: "Property Tax", category: "property_tax" };

  it("returns 202 with valid body and correct role", async () => {
    const res = await app.inject({ method: "POST", url: "/v1/revenue/rate-heads", headers: AUTH, payload: VALID_BODY });
    expect(res.statusCode).toBe(202);
    const json = res.json();
    expect(json.data).toHaveProperty("messageId");
  });

  it("returns 400 with invalid body", async () => {
    const res = await app.inject({ method: "POST", url: "/v1/revenue/rate-heads", headers: AUTH, payload: {} });
    expect(res.statusCode).toBe(400);
    expect(res.json().error.code).toBe("VALIDATION_FAILED");
  });

  it("returns 401 without auth", async () => {
    const res = await app.inject({ method: "POST", url: "/v1/revenue/rate-heads", payload: VALID_BODY });
    expect(res.statusCode).toBe(401);
  });

  it("returns 403 with wrong role", async () => {
    const res = await app.inject({ method: "POST", url: "/v1/revenue/rate-heads", headers: BAD_ROLE, payload: VALID_BODY });
    expect(res.statusCode).toBe(403);
  });
});

// ── POST /v1/revenue/rate-slabs ───────────────────────────────────────────────

describe("POST /v1/revenue/rate-slabs", () => {
  const VALID_BODY = {
    rateHeadId: "a1111111-1111-1111-1111-111111111111",
    slabType: "flat" as const,
    rateValue: "500000",
    effectiveFrom: "2024-04-01",
  };

  it("returns 202 with valid body", async () => {
    const res = await app.inject({ method: "POST", url: "/v1/revenue/rate-slabs", headers: AUTH, payload: VALID_BODY });
    expect(res.statusCode).toBe(202);
    expect(res.json().data).toHaveProperty("messageId");
  });

  it("returns 400 with missing rateHeadId", async () => {
    const res = await app.inject({ method: "POST", url: "/v1/revenue/rate-slabs", headers: AUTH, payload: { slabType: "flat" } });
    expect(res.statusCode).toBe(400);
  });

  it("returns 401 without auth", async () => {
    const res = await app.inject({ method: "POST", url: "/v1/revenue/rate-slabs", payload: VALID_BODY });
    expect(res.statusCode).toBe(401);
  });

  it("returns 403 with wrong role", async () => {
    const res = await app.inject({ method: "POST", url: "/v1/revenue/rate-slabs", headers: BAD_ROLE, payload: VALID_BODY });
    expect(res.statusCode).toBe(403);
  });
});

// ── POST /v1/revenue/penalty-rules ────────────────────────────────────────────

describe("POST /v1/revenue/penalty-rules", () => {
  const VALID_BODY = {
    rateHeadId: "a1111111-1111-1111-1111-111111111111",
    interestType: "simple" as const,
    annualRateBps: 1200,
    graceDays: 15,
    roundingMode: "round_half_up" as const,
  };

  it("returns 202 with valid body", async () => {
    const res = await app.inject({ method: "POST", url: "/v1/revenue/penalty-rules", headers: AUTH, payload: VALID_BODY });
    expect(res.statusCode).toBe(202);
    expect(res.json().data).toHaveProperty("messageId");
  });

  it("returns 400 with missing fields", async () => {
    const res = await app.inject({ method: "POST", url: "/v1/revenue/penalty-rules", headers: AUTH, payload: {} });
    expect(res.statusCode).toBe(400);
  });

  it("returns 401 without auth", async () => {
    const res = await app.inject({ method: "POST", url: "/v1/revenue/penalty-rules", payload: VALID_BODY });
    expect(res.statusCode).toBe(401);
  });

  it("returns 403 with wrong role", async () => {
    const res = await app.inject({ method: "POST", url: "/v1/revenue/penalty-rules", headers: BAD_ROLE, payload: VALID_BODY });
    expect(res.statusCode).toBe(403);
  });
});

// ── POST /v1/revenue/rebate-rules ─────────────────────────────────────────────

describe("POST /v1/revenue/rebate-rules", () => {
  const VALID_BODY = {
    rateHeadId: "a1111111-1111-1111-1111-111111111111",
    rebateType: "early_payment",
    discountBps: 500,
    validUntilDaysBeforeDue: 30,
  };

  it("returns 202 with valid body", async () => {
    const res = await app.inject({ method: "POST", url: "/v1/revenue/rebate-rules", headers: AUTH, payload: VALID_BODY });
    expect(res.statusCode).toBe(202);
    expect(res.json().data).toHaveProperty("messageId");
  });

  it("returns 400 with missing fields", async () => {
    const res = await app.inject({ method: "POST", url: "/v1/revenue/rebate-rules", headers: AUTH, payload: {} });
    expect(res.statusCode).toBe(400);
  });

  it("returns 401 without auth", async () => {
    const res = await app.inject({ method: "POST", url: "/v1/revenue/rebate-rules", payload: VALID_BODY });
    expect(res.statusCode).toBe(401);
  });

  it("returns 403 with wrong role", async () => {
    const res = await app.inject({ method: "POST", url: "/v1/revenue/rebate-rules", headers: BAD_ROLE, payload: VALID_BODY });
    expect(res.statusCode).toBe(403);
  });
});

// ── GET /v1/revenue/rate-heads (paginated) ────────────────────────────────────

describe("GET /v1/revenue/rate-heads", () => {
  it("returns 200 with paginated response", async () => {
    const res = await app.inject({ method: "GET", url: "/v1/revenue/rate-heads", headers: AUTH });
    expect(res.statusCode).toBe(200);
    const json = res.json();
    expect(json).toHaveProperty("data");
    expect(json).toHaveProperty("meta");
    expect(json.meta).toHaveProperty("page");
    expect(json.meta).toHaveProperty("pageSize");
    expect(json.meta).toHaveProperty("total");
  });

  it("returns 401 without auth", async () => {
    const res = await app.inject({ method: "GET", url: "/v1/revenue/rate-heads" });
    expect(res.statusCode).toBe(401);
  });

  it("returns 403 with wrong role", async () => {
    const res = await app.inject({ method: "GET", url: "/v1/revenue/rate-heads", headers: BAD_ROLE });
    expect(res.statusCode).toBe(403);
  });
});
