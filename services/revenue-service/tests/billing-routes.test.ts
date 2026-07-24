/**
 * Billing module — route-level integration tests.
 *
 * Covers: POST /bills/generate 202, GET /assessees/:id/bills paginated,
 * 400/401/403 error paths.
 */
import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";
import type { FastifyInstance } from "fastify";
import { signToken } from "@civitasone/auth";

const SECRET = "test_secret_for_civitasone_32chr";
const TENANT_ID = "t1111111-1111-1111-1111-111111111111";
const USER_ID = "u1111111-1111-1111-1111-111111111111";
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

// ── POST /v1/revenue/bills/generate ───────────────────────────────────────────

describe("POST /v1/revenue/bills/generate", () => {
  const VALID_BODY = { assessmentId: "c1111111-1111-1111-1111-111111111111" };

  it("returns 202 with valid body and correct role", async () => {
    const res = await app.inject({ method: "POST", url: "/v1/revenue/bills/generate", headers: AUTH, payload: VALID_BODY });
    expect(res.statusCode).toBe(202);
    expect(res.json().data).toHaveProperty("messageId");
  });

  it("returns 400 with invalid body (missing assessmentId)", async () => {
    const res = await app.inject({ method: "POST", url: "/v1/revenue/bills/generate", headers: AUTH, payload: {} });
    expect(res.statusCode).toBe(400);
    expect(res.json().error.code).toBe("VALIDATION_FAILED");
  });

  it("returns 400 with invalid UUID for assessmentId", async () => {
    const res = await app.inject({ method: "POST", url: "/v1/revenue/bills/generate", headers: AUTH, payload: { assessmentId: "not-a-uuid" } });
    expect(res.statusCode).toBe(400);
  });

  it("returns 401 without auth", async () => {
    const res = await app.inject({ method: "POST", url: "/v1/revenue/bills/generate", payload: VALID_BODY });
    expect(res.statusCode).toBe(401);
  });

  it("returns 403 with wrong role", async () => {
    const res = await app.inject({ method: "POST", url: "/v1/revenue/bills/generate", headers: BAD_ROLE, payload: VALID_BODY });
    expect(res.statusCode).toBe(403);
  });
});

// ── GET /v1/revenue/assessees/:id/bills (paginated) ───────────────────────────

describe("GET /v1/revenue/assessees/:id/bills", () => {
  it("returns 200 with paginated response", async () => {
    const res = await app.inject({ method: "GET", url: `/v1/revenue/assessees/${ASSESSEE_ID}/bills`, headers: AUTH });
    expect(res.statusCode).toBe(200);
    const json = res.json();
    expect(json).toHaveProperty("data");
    expect(json).toHaveProperty("meta");
    expect(json.meta).toHaveProperty("page");
    expect(json.meta).toHaveProperty("pageSize");
    expect(json.meta).toHaveProperty("total");
  });

  it("returns 400 with invalid UUID param", async () => {
    const res = await app.inject({ method: "GET", url: "/v1/revenue/assessees/not-a-uuid/bills", headers: AUTH });
    expect(res.statusCode).toBe(400);
  });

  it("returns 401 without auth", async () => {
    const res = await app.inject({ method: "GET", url: `/v1/revenue/assessees/${ASSESSEE_ID}/bills` });
    expect(res.statusCode).toBe(401);
  });

  it("returns 403 with wrong role", async () => {
    const res = await app.inject({ method: "GET", url: `/v1/revenue/assessees/${ASSESSEE_ID}/bills`, headers: BAD_ROLE });
    expect(res.statusCode).toBe(403);
  });
});
