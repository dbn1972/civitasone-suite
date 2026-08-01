/**
 * Arrears module — route-level integration tests.
 *
 * Covers: POST /instalments 202, POST /write-offs 202, GET /write-offs/:id,
 * PATCH /write-offs/:id/decide 202, POST /recovery-referrals 202,
 * GET /assessees/:id/instalments paginated, 400/401/403 error paths,
 * and cross-tenant isolation on GET /write-offs/:id.
 */
import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";
import type { FastifyInstance } from "fastify";
import { signToken } from "@civitasone/auth";

const SECRET = "test_secret_for_civitasone_32chr";
const TENANT_ID = "t1111111-1111-1111-1111-111111111111";
const TENANT_B_ID = "t9999999-9999-9999-9999-999999999999";
const USER_ID = "u1111111-1111-1111-1111-111111111111";
const ASSESSEE_ID = "a2222222-2222-2222-2222-222222222222";
const WRITEOFF_ID = "33333333-3333-3333-3333-333333333333";

function makeToken(roles: string[], tenantId: string = TENANT_ID) {
  return signToken({ sub: USER_ID, tid: tenantId, roles, sid: "s1" }, SECRET, 3600);
}

const AUTH = { authorization: `Bearer ${makeToken(["revenue_admin"])}` };
const BAD_ROLE = { authorization: `Bearer ${makeToken(["employee"])}` };
const AUTH_TENANT_B = { authorization: `Bearer ${makeToken(["revenue_admin"], TENANT_B_ID)}` };

// Seeded per-tenant write-off store used only by the findWriteOffById mock
// below, so GET /v1/revenue/write-offs/:id tests can assert on real field
// values (amount, reason, status) and on cross-tenant isolation without a
// live database.
const WRITEOFF_STORE: Record<string, { tenantId: string; [k: string]: unknown }> = {
  [WRITEOFF_ID]: {
    id: WRITEOFF_ID,
    tenantId: TENANT_ID,
    assesseeId: ASSESSEE_ID,
    amountMinor: 100000n,
    reason: "Unrecoverable after legal proceedings",
    status: "pending",
    makerUserId: "maker-11111111-1111-1111-1111-111111111111",
    checkerUserId: null,
  },
};

vi.mock("../src/modules/arrears/repo.js", async (importOriginal) => {
  const original = await importOriginal<typeof import("../src/modules/arrears/repo.js")>();
  return {
    ...original,
    findWriteOffById: vi.fn(async (tenantId: string, id: string) => {
      const row = WRITEOFF_STORE[id];
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

// ── POST /v1/revenue/instalments ──────────────────────────────────────────────

describe("POST /v1/revenue/instalments", () => {
  const VALID_BODY = {
    assesseeId: ASSESSEE_ID,
    instalmentCount: 6,
    startDate: "2024-07-01",
  };

  it("returns 202 with valid body and correct role", async () => {
    const res = await app.inject({ method: "POST", url: "/v1/revenue/instalments", headers: AUTH, payload: VALID_BODY });
    expect(res.statusCode).toBe(202);
    expect(res.json().data).toHaveProperty("messageId");
  });

  it("returns 400 with invalid instalmentCount (must be >= 2)", async () => {
    const res = await app.inject({ method: "POST", url: "/v1/revenue/instalments", headers: AUTH, payload: { ...VALID_BODY, instalmentCount: 1 } });
    expect(res.statusCode).toBe(400);
    expect(res.json().error.code).toBe("VALIDATION_FAILED");
  });

  it("returns 400 with invalid date format", async () => {
    const res = await app.inject({ method: "POST", url: "/v1/revenue/instalments", headers: AUTH, payload: { ...VALID_BODY, startDate: "01-07-2024" } });
    expect(res.statusCode).toBe(400);
  });

  it("returns 401 without auth", async () => {
    const res = await app.inject({ method: "POST", url: "/v1/revenue/instalments", payload: VALID_BODY });
    expect(res.statusCode).toBe(401);
  });

  it("returns 403 with wrong role", async () => {
    const res = await app.inject({ method: "POST", url: "/v1/revenue/instalments", headers: BAD_ROLE, payload: VALID_BODY });
    expect(res.statusCode).toBe(403);
  });
});

// ── POST /v1/revenue/write-offs ───────────────────────────────────────────────

describe("POST /v1/revenue/write-offs", () => {
  const VALID_BODY = {
    assesseeId: ASSESSEE_ID,
    amountMinor: "100000",
    reason: "Unrecoverable after legal proceedings",
  };

  it("returns 202 with valid body", async () => {
    const res = await app.inject({ method: "POST", url: "/v1/revenue/write-offs", headers: AUTH, payload: VALID_BODY });
    expect(res.statusCode).toBe(202);
    expect(res.json().data).toHaveProperty("messageId");
  });

  it("returns 400 with missing required fields", async () => {
    const res = await app.inject({ method: "POST", url: "/v1/revenue/write-offs", headers: AUTH, payload: { reason: "X" } });
    expect(res.statusCode).toBe(400);
  });

  it("returns 401 without auth", async () => {
    const res = await app.inject({ method: "POST", url: "/v1/revenue/write-offs", payload: VALID_BODY });
    expect(res.statusCode).toBe(401);
  });

  it("returns 403 with wrong role", async () => {
    const res = await app.inject({ method: "POST", url: "/v1/revenue/write-offs", headers: BAD_ROLE, payload: VALID_BODY });
    expect(res.statusCode).toBe(403);
  });
});

// ── GET /v1/revenue/write-offs/:id ─────────────────────────────────────────────

describe("GET /v1/revenue/write-offs/:id", () => {
  it("returns 200 with the full write-off record (amount, reason, status, requester)", async () => {
    const res = await app.inject({ method: "GET", url: `/v1/revenue/write-offs/${WRITEOFF_ID}`, headers: AUTH });
    expect(res.statusCode).toBe(200);
    const json = res.json();
    expect(json.data.id).toBe(WRITEOFF_ID);
    expect(json.data.amountMinor).toBe("100000");
    expect(json.data.reason).toBe("Unrecoverable after legal proceedings");
    expect(json.data.status).toBe("pending");
    expect(json.data.makerUserId).toBe("maker-11111111-1111-1111-1111-111111111111");
  });

  it("returns 404 for an unknown write-off id", async () => {
    const res = await app.inject({
      method: "GET",
      url: "/v1/revenue/write-offs/99999999-9999-9999-9999-999999999999",
      headers: AUTH,
    });
    expect(res.statusCode).toBe(404);
    expect(res.json().error.code).toBe("NOT_FOUND");
  });

  it("returns 404 (not the other tenant's data) when a different tenant requests this write-off — cross-tenant isolation", async () => {
    const res = await app.inject({ method: "GET", url: `/v1/revenue/write-offs/${WRITEOFF_ID}`, headers: AUTH_TENANT_B });
    expect(res.statusCode).toBe(404);
    expect(res.json().error.code).toBe("NOT_FOUND");
  });

  it("returns 400 with invalid UUID param", async () => {
    const res = await app.inject({ method: "GET", url: "/v1/revenue/write-offs/not-a-uuid", headers: AUTH });
    expect(res.statusCode).toBe(400);
  });

  it("returns 401 without auth", async () => {
    const res = await app.inject({ method: "GET", url: `/v1/revenue/write-offs/${WRITEOFF_ID}` });
    expect(res.statusCode).toBe(401);
  });

  it("returns 403 with wrong role", async () => {
    const res = await app.inject({ method: "GET", url: `/v1/revenue/write-offs/${WRITEOFF_ID}`, headers: BAD_ROLE });
    expect(res.statusCode).toBe(403);
  });
});

// ── PATCH /v1/revenue/write-offs/:id/decide ───────────────────────────────────

describe("PATCH /v1/revenue/write-offs/:id/decide", () => {
  const VALID_BODY = { approve: true, reason: "Finance approved" };

  it("returns 202 with valid body", async () => {
    const res = await app.inject({ method: "PATCH", url: `/v1/revenue/write-offs/${WRITEOFF_ID}/decide`, headers: AUTH, payload: VALID_BODY });
    expect(res.statusCode).toBe(202);
    expect(res.json().data).toHaveProperty("messageId");
  });

  it("returns 400 with missing approve field", async () => {
    const res = await app.inject({ method: "PATCH", url: `/v1/revenue/write-offs/${WRITEOFF_ID}/decide`, headers: AUTH, payload: { reason: "X" } });
    expect(res.statusCode).toBe(400);
  });

  it("returns 400 with invalid UUID param", async () => {
    const res = await app.inject({ method: "PATCH", url: "/v1/revenue/write-offs/not-a-uuid/decide", headers: AUTH, payload: VALID_BODY });
    expect(res.statusCode).toBe(400);
  });

  it("returns 401 without auth", async () => {
    const res = await app.inject({ method: "PATCH", url: `/v1/revenue/write-offs/${WRITEOFF_ID}/decide`, payload: VALID_BODY });
    expect(res.statusCode).toBe(401);
  });

  it("returns 403 with wrong role", async () => {
    const res = await app.inject({ method: "PATCH", url: `/v1/revenue/write-offs/${WRITEOFF_ID}/decide`, headers: BAD_ROLE, payload: VALID_BODY });
    expect(res.statusCode).toBe(403);
  });
});

// ── POST /v1/revenue/recovery-referrals ───────────────────────────────────────

describe("POST /v1/revenue/recovery-referrals", () => {
  const VALID_BODY = {
    assesseeId: ASSESSEE_ID,
    reason: "Persistent non-payment beyond 3 years",
  };

  it("returns 202 with valid body", async () => {
    const res = await app.inject({ method: "POST", url: "/v1/revenue/recovery-referrals", headers: AUTH, payload: VALID_BODY });
    expect(res.statusCode).toBe(202);
    expect(res.json().data).toHaveProperty("messageId");
  });

  it("returns 400 with missing fields", async () => {
    const res = await app.inject({ method: "POST", url: "/v1/revenue/recovery-referrals", headers: AUTH, payload: {} });
    expect(res.statusCode).toBe(400);
  });

  it("returns 401 without auth", async () => {
    const res = await app.inject({ method: "POST", url: "/v1/revenue/recovery-referrals", payload: VALID_BODY });
    expect(res.statusCode).toBe(401);
  });

  it("returns 403 with wrong role", async () => {
    const res = await app.inject({ method: "POST", url: "/v1/revenue/recovery-referrals", headers: BAD_ROLE, payload: VALID_BODY });
    expect(res.statusCode).toBe(403);
  });
});

// ── GET /v1/revenue/assessees/:id/instalments (paginated) ─────────────────────

describe("GET /v1/revenue/assessees/:id/instalments", () => {
  it("returns 200 with paginated response", async () => {
    const res = await app.inject({ method: "GET", url: `/v1/revenue/assessees/${ASSESSEE_ID}/instalments`, headers: AUTH });
    expect(res.statusCode).toBe(200);
    const json = res.json();
    expect(json).toHaveProperty("data");
    expect(json).toHaveProperty("meta");
    expect(json.meta).toHaveProperty("page");
    expect(json.meta).toHaveProperty("pageSize");
    expect(json.meta).toHaveProperty("total");
  });

  it("returns 400 with invalid UUID param", async () => {
    const res = await app.inject({ method: "GET", url: "/v1/revenue/assessees/not-a-uuid/instalments", headers: AUTH });
    expect(res.statusCode).toBe(400);
  });

  it("returns 401 without auth", async () => {
    const res = await app.inject({ method: "GET", url: `/v1/revenue/assessees/${ASSESSEE_ID}/instalments` });
    expect(res.statusCode).toBe(401);
  });

  it("returns 403 with wrong role", async () => {
    const res = await app.inject({ method: "GET", url: `/v1/revenue/assessees/${ASSESSEE_ID}/instalments`, headers: BAD_ROLE });
    expect(res.statusCode).toBe(403);
  });
});
