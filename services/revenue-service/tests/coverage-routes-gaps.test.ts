/**
 * Route coverage gaps: GET /rate-slabs, /penalty-rules, /rebate-rules,
 * BBPS enabled paths, billing GET /assessees/:id/bills,
 * error handler 500 path on all route modules.
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
  // Enable BBPS for these tests
  process.env.BBPS_ENABLED = "true";
  const { buildApp } = await import("../src/app.js");
  app = await buildApp();
  await app.ready();
});

afterAll(async () => {
  delete process.env.BBPS_ENABLED;
  await app.close();
});

// ═══════════════════════════════════════════════════════════════════════════════
// Rate Engine GET endpoints (previously uncovered)
// ═══════════════════════════════════════════════════════════════════════════════

describe("GET /v1/revenue/rate-slabs", () => {
  it("returns 200 with paginated response when rateHeadId provided", async () => {
    const res = await app.inject({
      method: "GET",
      url: "/v1/revenue/rate-slabs?rateHeadId=a1111111-1111-1111-1111-111111111111",
      headers: AUTH,
    });
    expect(res.statusCode).toBe(200);
    const json = res.json();
    expect(json).toHaveProperty("data");
    expect(json).toHaveProperty("meta");
  });

  it("returns 400 without rateHeadId", async () => {
    const res = await app.inject({
      method: "GET",
      url: "/v1/revenue/rate-slabs",
      headers: AUTH,
    });
    expect(res.statusCode).toBe(400);
  });
});

describe("GET /v1/revenue/penalty-rules", () => {
  it("returns 200 with paginated response when rateHeadId provided", async () => {
    const res = await app.inject({
      method: "GET",
      url: "/v1/revenue/penalty-rules?rateHeadId=a1111111-1111-1111-1111-111111111111",
      headers: AUTH,
    });
    expect(res.statusCode).toBe(200);
    const json = res.json();
    expect(json).toHaveProperty("data");
    expect(json).toHaveProperty("meta");
  });

  it("returns 400 without rateHeadId", async () => {
    const res = await app.inject({
      method: "GET",
      url: "/v1/revenue/penalty-rules",
      headers: AUTH,
    });
    expect(res.statusCode).toBe(400);
  });
});

describe("GET /v1/revenue/rebate-rules", () => {
  it("returns 200 with paginated response when rateHeadId provided", async () => {
    const res = await app.inject({
      method: "GET",
      url: "/v1/revenue/rebate-rules?rateHeadId=a1111111-1111-1111-1111-111111111111",
      headers: AUTH,
    });
    expect(res.statusCode).toBe(200);
    const json = res.json();
    expect(json).toHaveProperty("data");
    expect(json).toHaveProperty("meta");
  });

  it("returns 400 without rateHeadId", async () => {
    const res = await app.inject({
      method: "GET",
      url: "/v1/revenue/rebate-rules",
      headers: AUTH,
    });
    expect(res.statusCode).toBe(400);
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// BBPS routes when BBPS_ENABLED=true (previously uncovered happy paths)
// ═══════════════════════════════════════════════════════════════════════════════

describe("BBPS routes when BBPS_ENABLED=true", () => {
  it("POST /v1/revenue/bbps/fetch-bill returns 202 with valid body", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/v1/revenue/bbps/fetch-bill",
      headers: AUTH,
      payload: { assesseeIdentifier: "PROP-12345" },
    });
    expect(res.statusCode).toBe(202);
    expect(res.json().data).toHaveProperty("messageId");
  });

  it("POST /v1/revenue/bbps/fetch-bill returns 400 with invalid body", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/v1/revenue/bbps/fetch-bill",
      headers: AUTH,
      payload: {},
    });
    expect(res.statusCode).toBe(400);
  });

  it("POST /v1/revenue/bbps/pay-bill returns 202 with valid body", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/v1/revenue/bbps/pay-bill",
      headers: AUTH,
      payload: {
        assesseeIdentifier: "PROP-12345",
        amountMinor: "500000",
        bbpsTxnId: "TXN001",
        channel: "mobile",
      },
    });
    expect(res.statusCode).toBe(202);
    expect(res.json().data).toHaveProperty("messageId");
  });

  it("POST /v1/revenue/bbps/pay-bill returns 400 with invalid body", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/v1/revenue/bbps/pay-bill",
      headers: AUTH,
      payload: {},
    });
    expect(res.statusCode).toBe(400);
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// Route 500 Error Handler Paths
// ═══════════════════════════════════════════════════════════════════════════════

describe("Route 500 error handlers", () => {
  it("rate-engine route returns 500 on unexpected error", async () => {
    // Make queue.publish throw a generic error to trigger the 500 handler
    const { queue } = await import("../src/shared/infra.js");
    (queue.publish as any).mockRejectedValueOnce(new Error("Unexpected failure"));
    const res = await app.inject({
      method: "POST",
      url: "/v1/revenue/rate-heads",
      headers: AUTH,
      payload: { code: "PT", name: "Property Tax", category: "property_tax" },
    });
    expect(res.statusCode).toBe(500);
    expect(res.json().error.code).toBe("INTERNAL");
  });

  it("billing route returns 500 on unexpected error", async () => {
    const { queue } = await import("../src/shared/infra.js");
    (queue.publish as any).mockRejectedValueOnce(new Error("Unexpected failure"));
    const res = await app.inject({
      method: "POST",
      url: "/v1/revenue/bills/generate",
      headers: AUTH,
      payload: { assessmentId: "a1111111-1111-1111-1111-111111111111" },
    });
    expect(res.statusCode).toBe(500);
    expect(res.json().error.code).toBe("INTERNAL");
  });

  it("arrears route returns 500 on unexpected error", async () => {
    const { queue } = await import("../src/shared/infra.js");
    (queue.publish as any).mockRejectedValueOnce(new Error("Unexpected failure"));
    const res = await app.inject({
      method: "POST",
      url: "/v1/revenue/instalments",
      headers: AUTH,
      payload: { assesseeId: "a1111111-1111-1111-1111-111111111111", instalmentCount: 4, startDate: "2025-01-01" },
    });
    expect(res.statusCode).toBe(500);
    expect(res.json().error.code).toBe("INTERNAL");
  });

  it("collection route returns 500 on unexpected error", async () => {
    const { queue } = await import("../src/shared/infra.js");
    (queue.publish as any).mockRejectedValueOnce(new Error("Unexpected failure"));
    const res = await app.inject({
      method: "POST",
      url: "/v1/revenue/receipts",
      headers: AUTH,
      payload: { assesseeId: "a1111111-1111-1111-1111-111111111111", demandId: "d1111111-1111-1111-1111-111111111111", amountMinor: "100000", channel: "counter", reference: "REF-001" },
    });
    expect(res.statusCode).toBe(500);
    expect(res.json().error.code).toBe("INTERNAL");
  });

  it("assessee route returns 500 on unexpected error", async () => {
    const { queue } = await import("../src/shared/infra.js");
    (queue.publish as any).mockRejectedValueOnce(new Error("Unexpected failure"));
    const res = await app.inject({
      method: "POST",
      url: "/v1/revenue/assessees",
      headers: AUTH,
      payload: { name: "Test Owner" },
    });
    expect(res.statusCode).toBe(500);
  });

  it("bbps route returns 500 on unexpected error", async () => {
    const { queue } = await import("../src/shared/infra.js");
    (queue.publish as any).mockRejectedValueOnce(new Error("Unexpected failure"));
    const res = await app.inject({
      method: "POST",
      url: "/v1/revenue/bbps/fetch-bill",
      headers: AUTH,
      payload: { assesseeIdentifier: "PROP-12345" },
    });
    expect(res.statusCode).toBe(500);
    expect(res.json().error.code).toBe("INTERNAL");
  });
});

describe("GET /v1/revenue/assessees/:id/bills", () => {
  it("returns 200 with paginated response", async () => {
    const res = await app.inject({
      method: "GET",
      url: `/v1/revenue/assessees/a2222222-2222-2222-2222-222222222222/bills`,
      headers: AUTH,
    });
    expect(res.statusCode).toBe(200);
    const json = res.json();
    expect(json).toHaveProperty("data");
    expect(json).toHaveProperty("meta");
  });

  it("returns 401 without auth", async () => {
    const res = await app.inject({
      method: "GET",
      url: `/v1/revenue/assessees/a2222222-2222-2222-2222-222222222222/bills`,
    });
    expect(res.statusCode).toBe(401);
  });
});


// ═══════════════════════════════════════════════════════════════════════════════
// Billing GET /assessees/:id/bills (previously uncovered)
// ═══════════════════════════════════════════════════════════════════════════════

describe("GET /v1/revenue/assessees/:id/bills", () => {
  it("returns 200 with paginated response", async () => {
    const res = await app.inject({
      method: "GET",
      url: `/v1/revenue/assessees/a2222222-2222-2222-2222-222222222222/bills`,
      headers: AUTH,
    });
    expect(res.statusCode).toBe(200);
    const json = res.json();
    expect(json).toHaveProperty("data");
    expect(json).toHaveProperty("meta");
  });

  it("returns 401 without auth", async () => {
    const res = await app.inject({
      method: "GET",
      url: `/v1/revenue/assessees/a2222222-2222-2222-2222-222222222222/bills`,
    });
    expect(res.statusCode).toBe(401);
  });
});
