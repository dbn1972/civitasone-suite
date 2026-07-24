/**
 * Arrears module — route-level integration tests.
 *
 * Covers: POST /instalments 202, POST /write-offs 202, PATCH /write-offs/:id/decide 202,
 * POST /recovery-referrals 202, GET /assessees/:id/instalments paginated,
 * 400/401/403 error paths.
 */
import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";
import type { FastifyInstance } from "fastify";
import { signToken } from "@civitasone/auth";

const SECRET = "test_secret_for_civitasone_32chr";
const TENANT_ID = "t1111111-1111-1111-1111-111111111111";
const USER_ID = "u1111111-1111-1111-1111-111111111111";
const ASSESSEE_ID = "a2222222-2222-2222-2222-222222222222";
const WRITEOFF_ID = "w1111111-1111-1111-1111-111111111111";

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
