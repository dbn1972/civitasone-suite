/**
 * Collection module — route-level integration tests.
 *
 * Covers: POST /receipts 202, POST /refunds 202, GET /refunds/:id,
 * PATCH /refunds/:id/decide 202, POST /adjustments 202,
 * GET /assessees/:id/receipts paginated, 400/401/403 error paths,
 * and cross-tenant isolation on GET /refunds/:id.
 */
import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";
import type { FastifyInstance } from "fastify";
import { signToken } from "@civitasone/auth";

const SECRET = "test_secret_for_civitasone_32chr";
const TENANT_ID = "t1111111-1111-1111-1111-111111111111";
const TENANT_B_ID = "t9999999-9999-9999-9999-999999999999";
const USER_ID = "u1111111-1111-1111-1111-111111111111";
const ASSESSEE_ID = "a2222222-2222-2222-2222-222222222222";
const DEMAND_ID = "d1111111-1111-1111-1111-111111111111";
const RECEIPT_ID = "11111111-1111-1111-1111-111111111111";
const REFUND_ID = "22222222-2222-2222-2222-222222222222";

function makeToken(roles: string[], tenantId: string = TENANT_ID) {
  return signToken({ sub: USER_ID, tid: tenantId, roles, sid: "s1" }, SECRET, 3600);
}

const AUTH = { authorization: `Bearer ${makeToken(["revenue_admin"])}` };
const BAD_ROLE = { authorization: `Bearer ${makeToken(["employee"])}` };
const AUTH_TENANT_B = { authorization: `Bearer ${makeToken(["revenue_admin"], TENANT_B_ID)}` };

// Seeded per-tenant refund store used only by the findRefundById mock below, so
// GET /v1/revenue/refunds/:id tests can assert on real field values (amount,
// reason, status) and on cross-tenant isolation without a live database.
const REFUND_STORE: Record<string, { tenantId: string; [k: string]: unknown }> = {
  [REFUND_ID]: {
    id: REFUND_ID,
    tenantId: TENANT_ID,
    receiptId: RECEIPT_ID,
    assesseeId: ASSESSEE_ID,
    amountMinor: 250000n,
    reason: "Duplicate payment",
    status: "pending",
    makerUserId: "maker-11111111-1111-1111-1111-111111111111",
    checkerUserId: null,
  },
};

vi.mock("../src/modules/collection/repo.js", async (importOriginal) => {
  const original = await importOriginal<typeof import("../src/modules/collection/repo.js")>();
  return {
    ...original,
    findRefundById: vi.fn(async (tenantId: string, id: string) => {
      const row = REFUND_STORE[id];
      if (!row || row.tenantId !== tenantId) return null;
      return row;
    }),
  };
});

// ── Mocks ─────────────────────────────────────────────────────────────────────

vi.mock("../src/shared/db.js", () => ({
  db: {
    transaction: vi.fn(async (fn: (tx: unknown) => Promise<unknown>) => fn({})),
    select: vi.fn().mockReturnThis(),
    from: vi.fn().mockReturnThis(),
    where: vi.fn().mockReturnThis(),
    orderBy: vi.fn().mockReturnThis(),
    limit: vi.fn().mockResolvedValue([]),
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

// ── POST /v1/revenue/receipts ─────────────────────────────────────────────────

describe("POST /v1/revenue/receipts", () => {
  const VALID_BODY = {
    assesseeId: ASSESSEE_ID,
    demandId: DEMAND_ID,
    amountMinor: "500000",
    channel: "counter",
    reference: "REF-001",
  };

  it("returns 202 with valid body and correct role", async () => {
    const res = await app.inject({ method: "POST", url: "/v1/revenue/receipts", headers: AUTH, payload: VALID_BODY });
    expect(res.statusCode).toBe(202);
    expect(res.json().data).toHaveProperty("messageId");
  });

  it("returns 400 with missing required fields", async () => {
    const res = await app.inject({ method: "POST", url: "/v1/revenue/receipts", headers: AUTH, payload: { channel: "counter" } });
    expect(res.statusCode).toBe(400);
    expect(res.json().error.code).toBe("VALIDATION_FAILED");
  });

  it("returns 401 without auth", async () => {
    const res = await app.inject({ method: "POST", url: "/v1/revenue/receipts", payload: VALID_BODY });
    expect(res.statusCode).toBe(401);
  });

  it("returns 403 with wrong role", async () => {
    const res = await app.inject({ method: "POST", url: "/v1/revenue/receipts", headers: BAD_ROLE, payload: VALID_BODY });
    expect(res.statusCode).toBe(403);
  });
});

// ── POST /v1/revenue/refunds ──────────────────────────────────────────────────

describe("POST /v1/revenue/refunds", () => {
  const VALID_BODY = { receiptId: RECEIPT_ID, reason: "Duplicate payment" };

  it("returns 202 with valid body", async () => {
    const res = await app.inject({ method: "POST", url: "/v1/revenue/refunds", headers: AUTH, payload: VALID_BODY });
    expect(res.statusCode).toBe(202);
    expect(res.json().data).toHaveProperty("messageId");
  });

  it("returns 400 with missing receiptId", async () => {
    const res = await app.inject({ method: "POST", url: "/v1/revenue/refunds", headers: AUTH, payload: { reason: "X" } });
    expect(res.statusCode).toBe(400);
  });

  it("returns 401 without auth", async () => {
    const res = await app.inject({ method: "POST", url: "/v1/revenue/refunds", payload: VALID_BODY });
    expect(res.statusCode).toBe(401);
  });

  it("returns 403 with wrong role", async () => {
    const res = await app.inject({ method: "POST", url: "/v1/revenue/refunds", headers: BAD_ROLE, payload: VALID_BODY });
    expect(res.statusCode).toBe(403);
  });
});

// ── GET /v1/revenue/refunds/:id ────────────────────────────────────────────────

describe("GET /v1/revenue/refunds/:id", () => {
  it("returns 200 with the full refund record (amount, reason, status, requester)", async () => {
    const res = await app.inject({ method: "GET", url: `/v1/revenue/refunds/${REFUND_ID}`, headers: AUTH });
    expect(res.statusCode).toBe(200);
    const json = res.json();
    expect(json.data.id).toBe(REFUND_ID);
    expect(json.data.amountMinor).toBe("250000");
    expect(json.data.reason).toBe("Duplicate payment");
    expect(json.data.status).toBe("pending");
    expect(json.data.makerUserId).toBe("maker-11111111-1111-1111-1111-111111111111");
  });

  it("returns 404 for an unknown refund id", async () => {
    const res = await app.inject({
      method: "GET",
      url: "/v1/revenue/refunds/99999999-9999-9999-9999-999999999999",
      headers: AUTH,
    });
    expect(res.statusCode).toBe(404);
    expect(res.json().error.code).toBe("NOT_FOUND");
  });

  it("returns 404 (not the other tenant's data) when a different tenant requests this refund — cross-tenant isolation", async () => {
    const res = await app.inject({ method: "GET", url: `/v1/revenue/refunds/${REFUND_ID}`, headers: AUTH_TENANT_B });
    expect(res.statusCode).toBe(404);
    expect(res.json().error.code).toBe("NOT_FOUND");
  });

  it("returns 400 with invalid UUID param", async () => {
    const res = await app.inject({ method: "GET", url: "/v1/revenue/refunds/not-a-uuid", headers: AUTH });
    expect(res.statusCode).toBe(400);
  });

  it("returns 401 without auth", async () => {
    const res = await app.inject({ method: "GET", url: `/v1/revenue/refunds/${REFUND_ID}` });
    expect(res.statusCode).toBe(401);
  });

  it("returns 403 with wrong role", async () => {
    const res = await app.inject({ method: "GET", url: `/v1/revenue/refunds/${REFUND_ID}`, headers: BAD_ROLE });
    expect(res.statusCode).toBe(403);
  });
});

// ── PATCH /v1/revenue/refunds/:id/decide ──────────────────────────────────────

describe("PATCH /v1/revenue/refunds/:id/decide", () => {
  const VALID_BODY = { approve: true, reason: "Verified" };

  it("returns 202 with valid body", async () => {
    const res = await app.inject({ method: "PATCH", url: `/v1/revenue/refunds/${REFUND_ID}/decide`, headers: AUTH, payload: VALID_BODY });
    expect(res.statusCode).toBe(202);
    expect(res.json().data).toHaveProperty("messageId");
  });

  it("returns 400 with missing approve field", async () => {
    const res = await app.inject({ method: "PATCH", url: `/v1/revenue/refunds/${REFUND_ID}/decide`, headers: AUTH, payload: { reason: "X" } });
    expect(res.statusCode).toBe(400);
  });

  it("returns 400 with invalid UUID param", async () => {
    const res = await app.inject({ method: "PATCH", url: "/v1/revenue/refunds/not-a-uuid/decide", headers: AUTH, payload: VALID_BODY });
    expect(res.statusCode).toBe(400);
  });

  it("returns 401 without auth", async () => {
    const res = await app.inject({ method: "PATCH", url: `/v1/revenue/refunds/${REFUND_ID}/decide`, payload: VALID_BODY });
    expect(res.statusCode).toBe(401);
  });

  it("returns 403 with wrong role", async () => {
    const res = await app.inject({ method: "PATCH", url: `/v1/revenue/refunds/${REFUND_ID}/decide`, headers: BAD_ROLE, payload: VALID_BODY });
    expect(res.statusCode).toBe(403);
  });
});

// ── POST /v1/revenue/adjustments ──────────────────────────────────────────────

describe("POST /v1/revenue/adjustments", () => {
  const VALID_BODY = {
    assesseeId: ASSESSEE_ID,
    fromDemandId: DEMAND_ID,
    toDemandId: "d2222222-2222-2222-2222-222222222222",
    amountMinor: "100000",
    reason: "Transfer excess to next period",
  };

  it("returns 202 with valid body", async () => {
    const res = await app.inject({ method: "POST", url: "/v1/revenue/adjustments", headers: AUTH, payload: VALID_BODY });
    expect(res.statusCode).toBe(202);
    expect(res.json().data).toHaveProperty("messageId");
  });

  it("returns 400 with missing fields", async () => {
    const res = await app.inject({ method: "POST", url: "/v1/revenue/adjustments", headers: AUTH, payload: { reason: "X" } });
    expect(res.statusCode).toBe(400);
  });

  it("returns 401 without auth", async () => {
    const res = await app.inject({ method: "POST", url: "/v1/revenue/adjustments", payload: VALID_BODY });
    expect(res.statusCode).toBe(401);
  });

  it("returns 403 with wrong role", async () => {
    const res = await app.inject({ method: "POST", url: "/v1/revenue/adjustments", headers: BAD_ROLE, payload: VALID_BODY });
    expect(res.statusCode).toBe(403);
  });
});

// ── GET /v1/revenue/assessees/:id/receipts (paginated) ────────────────────────

describe("GET /v1/revenue/assessees/:id/receipts", () => {
  it("returns 200 with paginated response", async () => {
    const res = await app.inject({ method: "GET", url: `/v1/revenue/assessees/${ASSESSEE_ID}/receipts`, headers: AUTH });
    expect(res.statusCode).toBe(200);
    const json = res.json();
    expect(json).toHaveProperty("data");
    expect(json).toHaveProperty("meta");
    expect(json.meta).toHaveProperty("page");
    expect(json.meta).toHaveProperty("pageSize");
    expect(json.meta).toHaveProperty("total");
  });

  it("returns 400 with invalid UUID param", async () => {
    const res = await app.inject({ method: "GET", url: "/v1/revenue/assessees/not-a-uuid/receipts", headers: AUTH });
    expect(res.statusCode).toBe(400);
  });

  it("returns 401 without auth", async () => {
    const res = await app.inject({ method: "GET", url: `/v1/revenue/assessees/${ASSESSEE_ID}/receipts` });
    expect(res.statusCode).toBe(401);
  });

  it("returns 403 with wrong role", async () => {
    const res = await app.inject({ method: "GET", url: `/v1/revenue/assessees/${ASSESSEE_ID}/receipts`, headers: BAD_ROLE });
    expect(res.statusCode).toBe(403);
  });
});
