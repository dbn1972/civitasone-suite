/**
 * Assessment module — route-level integration tests.
 *
 * Covers: POST /assessments 202, PATCH /assessments/:id/revise 202,
 * POST /assessments/:id/remit 202, PATCH /assessments/:id/remit-decide 202,
 * GET /assessments paginated, GET /assessees/:id/demands, GET /assessees/:id/dcb,
 * 400/401/403 error paths.
 */
import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";
import type { FastifyInstance } from "fastify";
import { signToken } from "@civitasone/auth";

const SECRET = "test_secret_for_civitasone_32chr";
const TENANT_ID = "t1111111-1111-1111-1111-111111111111";
const USER_ID = "u1111111-1111-1111-1111-111111111111";
const ASSESSMENT_ID = "a3333333-3333-3333-3333-333333333333";
const ASSESSEE_ID = "a2222222-2222-2222-2222-222222222222";

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

// ── POST /v1/revenue/assessments ──────────────────────────────────────────────

describe("POST /v1/revenue/assessments", () => {
  const VALID_BODY = {
    assesseeId: ASSESSEE_ID,
    rateHeadId: "b1111111-1111-1111-1111-111111111111",
    financialYear: "2024-25",
    baseValue: "10000000",
  };

  it("returns 202 with valid body and correct role", async () => {
    const res = await app.inject({ method: "POST", url: "/v1/revenue/assessments", headers: AUTH, payload: VALID_BODY });
    expect(res.statusCode).toBe(202);
    expect(res.json().data).toHaveProperty("messageId");
  });

  it("returns 400 with invalid body (missing assesseeId)", async () => {
    const res = await app.inject({ method: "POST", url: "/v1/revenue/assessments", headers: AUTH, payload: { financialYear: "2024-25" } });
    expect(res.statusCode).toBe(400);
    expect(res.json().error.code).toBe("VALIDATION_FAILED");
  });

  it("returns 400 with invalid financialYear format", async () => {
    const res = await app.inject({
      method: "POST", url: "/v1/revenue/assessments", headers: AUTH,
      payload: { ...VALID_BODY, financialYear: "2024" },
    });
    expect(res.statusCode).toBe(400);
  });

  it("returns 401 without auth", async () => {
    const res = await app.inject({ method: "POST", url: "/v1/revenue/assessments", payload: VALID_BODY });
    expect(res.statusCode).toBe(401);
  });

  it("returns 403 with wrong role", async () => {
    const res = await app.inject({ method: "POST", url: "/v1/revenue/assessments", headers: BAD_ROLE, payload: VALID_BODY });
    expect(res.statusCode).toBe(403);
  });
});

// ── PATCH /v1/revenue/assessments/:id/revise ──────────────────────────────────

describe("PATCH /v1/revenue/assessments/:id/revise", () => {
  const VALID_BODY = { version: 1, reason: "Corrected base value", newBaseValue: "12000000" };

  it("returns 202 with valid body", async () => {
    const res = await app.inject({ method: "PATCH", url: `/v1/revenue/assessments/${ASSESSMENT_ID}/revise`, headers: AUTH, payload: VALID_BODY });
    expect(res.statusCode).toBe(202);
    expect(res.json().data).toHaveProperty("messageId");
  });

  it("returns 400 with missing version", async () => {
    const res = await app.inject({ method: "PATCH", url: `/v1/revenue/assessments/${ASSESSMENT_ID}/revise`, headers: AUTH, payload: { reason: "X" } });
    expect(res.statusCode).toBe(400);
  });

  it("returns 400 with invalid UUID param", async () => {
    const res = await app.inject({ method: "PATCH", url: "/v1/revenue/assessments/not-a-uuid/revise", headers: AUTH, payload: VALID_BODY });
    expect(res.statusCode).toBe(400);
  });

  it("returns 401 without auth", async () => {
    const res = await app.inject({ method: "PATCH", url: `/v1/revenue/assessments/${ASSESSMENT_ID}/revise`, payload: VALID_BODY });
    expect(res.statusCode).toBe(401);
  });

  it("returns 403 with wrong role", async () => {
    const res = await app.inject({ method: "PATCH", url: `/v1/revenue/assessments/${ASSESSMENT_ID}/revise`, headers: BAD_ROLE, payload: VALID_BODY });
    expect(res.statusCode).toBe(403);
  });
});

// ── POST /v1/revenue/assessments/:id/remit ────────────────────────────────────

describe("POST /v1/revenue/assessments/:id/remit", () => {
  const VALID_BODY = { reason: "Flood damage relief", remissionPercent: 50 };

  it("returns 202 with valid body", async () => {
    const res = await app.inject({ method: "POST", url: `/v1/revenue/assessments/${ASSESSMENT_ID}/remit`, headers: AUTH, payload: VALID_BODY });
    expect(res.statusCode).toBe(202);
    expect(res.json().data).toHaveProperty("messageId");
  });

  it("returns 400 with invalid remissionPercent", async () => {
    const res = await app.inject({ method: "POST", url: `/v1/revenue/assessments/${ASSESSMENT_ID}/remit`, headers: AUTH, payload: { reason: "X", remissionPercent: 0 } });
    expect(res.statusCode).toBe(400);
  });

  it("returns 401 without auth", async () => {
    const res = await app.inject({ method: "POST", url: `/v1/revenue/assessments/${ASSESSMENT_ID}/remit`, payload: VALID_BODY });
    expect(res.statusCode).toBe(401);
  });

  it("returns 403 with wrong role", async () => {
    const res = await app.inject({ method: "POST", url: `/v1/revenue/assessments/${ASSESSMENT_ID}/remit`, headers: BAD_ROLE, payload: VALID_BODY });
    expect(res.statusCode).toBe(403);
  });
});

// ── PATCH /v1/revenue/assessments/:id/remit-decide ────────────────────────────

describe("PATCH /v1/revenue/assessments/:id/remit-decide", () => {
  const VALID_BODY = { approve: true, reason: "Verified by finance" };

  it("returns 202 with valid body", async () => {
    const res = await app.inject({ method: "PATCH", url: `/v1/revenue/assessments/${ASSESSMENT_ID}/remit-decide`, headers: AUTH, payload: VALID_BODY });
    expect(res.statusCode).toBe(202);
    expect(res.json().data).toHaveProperty("messageId");
  });

  it("returns 400 with missing approve field", async () => {
    const res = await app.inject({ method: "PATCH", url: `/v1/revenue/assessments/${ASSESSMENT_ID}/remit-decide`, headers: AUTH, payload: { reason: "no" } });
    expect(res.statusCode).toBe(400);
  });

  it("returns 401 without auth", async () => {
    const res = await app.inject({ method: "PATCH", url: `/v1/revenue/assessments/${ASSESSMENT_ID}/remit-decide`, payload: VALID_BODY });
    expect(res.statusCode).toBe(401);
  });

  it("returns 403 with wrong role", async () => {
    const res = await app.inject({ method: "PATCH", url: `/v1/revenue/assessments/${ASSESSMENT_ID}/remit-decide`, headers: BAD_ROLE, payload: VALID_BODY });
    expect(res.statusCode).toBe(403);
  });
});

// ── GET /v1/revenue/assessments (paginated) ───────────────────────────────────

describe("GET /v1/revenue/assessments", () => {
  it("returns 200 with paginated response", async () => {
    const res = await app.inject({ method: "GET", url: "/v1/revenue/assessments", headers: AUTH });
    expect(res.statusCode).toBe(200);
    const json = res.json();
    expect(json).toHaveProperty("data");
    expect(json).toHaveProperty("meta");
    expect(json.meta).toHaveProperty("page");
    expect(json.meta).toHaveProperty("pageSize");
    expect(json.meta).toHaveProperty("total");
  });

  it("returns 401 without auth", async () => {
    const res = await app.inject({ method: "GET", url: "/v1/revenue/assessments" });
    expect(res.statusCode).toBe(401);
  });

  it("returns 403 with wrong role", async () => {
    const res = await app.inject({ method: "GET", url: "/v1/revenue/assessments", headers: BAD_ROLE });
    expect(res.statusCode).toBe(403);
  });
});

// ── GET /v1/revenue/assessees/:id/demands ─────────────────────────────────────

describe("GET /v1/revenue/assessees/:id/demands", () => {
  it("returns 200 with data array", async () => {
    const res = await app.inject({ method: "GET", url: `/v1/revenue/assessees/${ASSESSEE_ID}/demands`, headers: AUTH });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toHaveProperty("data");
  });

  it("returns 401 without auth", async () => {
    const res = await app.inject({ method: "GET", url: `/v1/revenue/assessees/${ASSESSEE_ID}/demands` });
    expect(res.statusCode).toBe(401);
  });

  it("returns 403 with wrong role", async () => {
    const res = await app.inject({ method: "GET", url: `/v1/revenue/assessees/${ASSESSEE_ID}/demands`, headers: BAD_ROLE });
    expect(res.statusCode).toBe(403);
  });
});

// ── GET /v1/revenue/assessees/:id/dcb ─────────────────────────────────────────

describe("GET /v1/revenue/assessees/:id/dcb", () => {
  it("returns 200 with data", async () => {
    const res = await app.inject({ method: "GET", url: `/v1/revenue/assessees/${ASSESSEE_ID}/dcb`, headers: AUTH });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toHaveProperty("data");
  });

  it("returns 401 without auth", async () => {
    const res = await app.inject({ method: "GET", url: `/v1/revenue/assessees/${ASSESSEE_ID}/dcb` });
    expect(res.statusCode).toBe(401);
  });

  it("returns 403 with wrong role", async () => {
    const res = await app.inject({ method: "GET", url: `/v1/revenue/assessees/${ASSESSEE_ID}/dcb`, headers: BAD_ROLE });
    expect(res.statusCode).toBe(403);
  });
});
