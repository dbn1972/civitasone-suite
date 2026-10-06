/**
 * Contractor route-boundary tests for works-service — auth (401/403),
 * validation (400) and the audited PAN-reveal / rating-comment behaviour.
 *
 * Mirrors tests/all-routes.test.ts's buildApp + inject harness: the DB, queue,
 * outbox, cache and auth plugin are mocked, so this suite needs NO live
 * Postgres (the shared test DB is unavailable in this environment). The only
 * module whose behaviour we assert on is the contractor module itself.
 *
 * Covers:
 *   GAP-WORKS-CONTRACTORS-06        — GET list enforces reader roles + shape.
 *   GAP-WORKS-CONTRACTORS-DETAIL-06 — GET :id / rating-history / PATCH / rate roles.
 *   GAP-WORKS-CONTRACTORS-NEW-05    — POST create enforces write roles.
 *   GAP-WORKS-CONTRACTORS-NEW-01    — PAN/GSTIN/mobile FORMAT validation (400).
 *   GAP-WORKS-CONTRACTORS-DETAIL-04 — rate accepts an optional comment.
 *   GAP-WORKS-CONTRACTORS-DETAIL-02 — reveal-pan is role-gated, reason-required.
 */
import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";
import type { FastifyInstance } from "fastify";

const CONTRACTOR_ID = "00000000-cccc-4000-8000-000000000001";
const publishMock = vi.fn().mockResolvedValue(undefined);
const enqueueMock = vi.fn().mockResolvedValue(undefined);

vi.mock("@civitasone/db", () => ({
  createTenantDb: () => ({ sqlClient: { end: vi.fn() }, db: {}, dbFor: vi.fn(), sqlClientFor: vi.fn(), tierOf: vi.fn(), dbForRead: vi.fn() }),
  createTenantTxHook: () => async () => {},
  tenantStorage: { enterWith: vi.fn() },
  runWithTenant: vi.fn((_t: string, fn: Function) => fn()),
}));

vi.mock("@civitasone/cache", () => ({
  Cache: class { getOrLoad() { return Promise.resolve(null); } invalidate() { return Promise.resolve(); } },
}));

// Shared db: transaction runs the callback with a no-op tx (the reveal command
// only uses it to enqueue an audit outbox row, which is mocked above).
vi.mock("../src/shared/db.js", () => ({
  db: { transaction: (fn: Function) => fn({}) },
  sqlClient: { end: vi.fn() },
  scopedRead: vi.fn(async () => []),
}));

vi.mock("@civitasone/queue", () => ({
  createQueue: () => ({ publish: publishMock, subscribe: vi.fn(), start: vi.fn(), stop: vi.fn() }),
  MemoryQueue: class { publish = publishMock; subscribe = vi.fn(); start = vi.fn(); stop = vi.fn(); },
}));

vi.mock("@civitasone/observability", () => ({ registerOpsRoutes: vi.fn(), dbPing: vi.fn() }));

vi.mock("@civitasone/outbox", () => ({
  outboxMessages: {}, processed: {}, outboxSchema: {},
  enqueue: enqueueMock, markProcessed: vi.fn().mockResolvedValue(true), startRelay: vi.fn(() => setInterval(() => {}, 999999)),
}));

vi.mock("@civitasone/schemas/plugin", () => ({
  registerSchemaErrorHandler: (app: any, HttpError: any) => {
    app.setErrorHandler((err: any, _req: any, reply: any) => {
      if (err instanceof HttpError) return reply.status(err.status).send({ error: { code: err.code, message: err.message } });
      if (err.name === "ZodError" || err.issues) return reply.status(400).send({ error: { code: "VALIDATION_ERROR" } });
      if (err.validation || err.statusCode === 400) return reply.status(400).send({ error: { code: "VALIDATION_ERROR" } });
      return reply.status(500).send({ error: { code: "INTERNAL" } });
    });
  },
}));

vi.mock("@civitasone/auth/plugin", () => ({
  authPlugin: Object.assign(async (app: any) => {
    app.decorateRequest("ctx", undefined);
    app.addHook("onRequest", async (req: any) => {
      const auth = req.headers?.authorization;
      if (!auth) return;
      try {
        const [, body] = auth.replace("Bearer ", "").split(".");
        const payload = JSON.parse(Buffer.from(body, "base64url").toString());
        (req as any).ctx = { tenantId: payload.tid, actorId: payload.sub, roles: payload.roles || [], correlationId: req.id || "c", sessionId: "s", actorType: "user" };
      } catch { /* leave ctx null */ }
    });
  }, { [Symbol.for("skip-override")]: true, [Symbol.for("fastify.display-name")]: "civitasone-auth" }),
}));

vi.mock("@civitasone/auth/context", () => {
  class AuthContextError extends Error {
    status: number; code: string;
    constructor(s: number, c: string, m: string) { super(m); this.status = s; this.code = c; }
  }
  return {
    resolveServiceContext: (req: any) => { if (!req.ctx) throw new AuthContextError(401, "UNAUTHENTICATED", "missing token"); return req.ctx; },
    AuthContextError,
  };
});

vi.mock("@civitasone/auth", () => ({
  hasAnyRole: (ctx: any, roles: string[]) => roles.some((r: string) => ctx.roles?.includes(r)),
}));

// Contractor repo: a known contractor with an encrypted-at-rest PAN that the
// repo (via encryptedText) returns decrypted. Rating history carries a note.
vi.mock("../src/modules/contractor/repo.js", async (importOriginal) => {
  const orig = await importOriginal<typeof import("../src/modules/contractor/repo.js")>();
  return {
    ...orig,
    findContractorById: vi.fn(async (_t: string, id: string) =>
      id === CONTRACTOR_ID ? { id, name: "ABC Constructions", pan: "AAAPZ1234C", active: true } : null),
    listContractors: vi.fn(async () => [{ id: CONTRACTOR_ID, name: "ABC Constructions", active: true }]),
    listRatingHistory: vi.fn(async () => [{ id: "r1", rating: 4, ratedBy: "u1", ratedAt: new Date().toISOString(), note: "good work" }]),
  };
});

const ACTOR = "00000000-aaaa-4000-8000-000000000001";
const TENANT = "11111111-bbbb-4000-8000-000000000001";
function authHeader(roles: string[] = ["works_admin"]) {
  const header = Buffer.from(JSON.stringify({ alg: "HS256", typ: "JWT" })).toString("base64url");
  const body = Buffer.from(JSON.stringify({ sub: ACTOR, tid: TENANT, roles, exp: Math.floor(Date.now() / 1000) + 3600 })).toString("base64url");
  return { authorization: `Bearer ${header}.${body}.${Buffer.from("sig").toString("base64url")}` };
}

let app: FastifyInstance;
beforeAll(async () => {
  process.env.PII_ENC_KEY = process.env.PII_ENC_KEY ?? "test_pii_encryption_key_32chars!!";
  const { buildApp } = await import("../src/app.js");
  app = await buildApp();
});
afterAll(async () => { await app.close(); });

// ── GAP-WORKS-CONTRACTORS-06: list roles + shape ───────────────────────────
describe("GET /v1/works/contractors (GAP-06)", () => {
  it("401 without a token", async () => {
    const res = await app.inject({ method: "GET", url: "/v1/works/contractors" });
    expect(res.statusCode).toBe(401);
  });
  it("403 for a role with no works access", async () => {
    const res = await app.inject({ method: "GET", url: "/v1/works/contractors", headers: authHeader(["citizen"]) });
    expect(res.statusCode).toBe(403);
  });
  it("200 + { data: [...] } for a reader role", async () => {
    const res = await app.inject({ method: "GET", url: "/v1/works/contractors", headers: authHeader(["works_viewer"]) });
    expect(res.statusCode).toBe(200);
    expect(Array.isArray(res.json().data)).toBe(true);
  });
});

// ── GAP-WORKS-CONTRACTORS-DETAIL-06: detail/history/patch/rate roles ────────
describe("contractor detail routes (GAP-DETAIL-06)", () => {
  it("GET :id → 403 for citizen, 200 for reader", async () => {
    expect((await app.inject({ method: "GET", url: `/v1/works/contractors/${CONTRACTOR_ID}`, headers: authHeader(["citizen"]) })).statusCode).toBe(403);
    const ok = await app.inject({ method: "GET", url: `/v1/works/contractors/${CONTRACTOR_ID}`, headers: authHeader(["estimator"]) });
    expect(ok.statusCode).toBe(200);
    expect(ok.json().data.id).toBe(CONTRACTOR_ID);
  });
  it("GET rating-history → 200 for reader with { data: [...] } incl. note", async () => {
    const res = await app.inject({ method: "GET", url: `/v1/works/contractors/${CONTRACTOR_ID}/rating-history`, headers: authHeader(["works_viewer"]) });
    expect(res.statusCode).toBe(200);
    expect(res.json().data[0].note).toBe("good work");
  });
  it("PATCH :id → 403 for a read-only role (works_viewer is not a write role)", async () => {
    const res = await app.inject({ method: "PATCH", url: `/v1/works/contractors/${CONTRACTOR_ID}`, headers: authHeader(["works_viewer"]), payload: { name: "New Name" } });
    expect(res.statusCode).toBe(403);
  });
});

// ── GAP-WORKS-CONTRACTORS-NEW-05 + NEW-01: create roles + format validation ─
describe("POST /v1/works/contractors (GAP-NEW-05 / NEW-01)", () => {
  it("403 for a read-only role", async () => {
    const res = await app.inject({ method: "POST", url: "/v1/works/contractors", headers: authHeader(["works_viewer"]), payload: { name: "X" } });
    expect(res.statusCode).toBe(403);
  });
  it("202 for a write role with a valid body", async () => {
    const res = await app.inject({ method: "POST", url: "/v1/works/contractors", headers: authHeader(["works_admin"]), payload: { name: "ABC", pan: "AAAPZ1234C", gst: "29AAAPZ1234C1Z5" } });
    expect(res.statusCode).toBe(202);
  });
  it("400 on a malformed PAN", async () => {
    const res = await app.inject({ method: "POST", url: "/v1/works/contractors", headers: authHeader(["works_admin"]), payload: { name: "ABC", pan: "ABCDE12345" } });
    expect(res.statusCode).toBe(400);
  });
  it("400 on a malformed GSTIN and a 9-digit mobile", async () => {
    expect((await app.inject({ method: "POST", url: "/v1/works/contractors", headers: authHeader(["works_admin"]), payload: { name: "ABC", gst: "BADGSTIN" } })).statusCode).toBe(400);
    expect((await app.inject({ method: "POST", url: "/v1/works/contractors", headers: authHeader(["works_admin"]), payload: { name: "ABC", phone: "987654321" } })).statusCode).toBe(400);
  });
});

// ── GAP-WORKS-CONTRACTORS-DETAIL-04: rate accepts an optional comment ───────
describe("PATCH /v1/works/contractors/:id/rate (GAP-DETAIL-04)", () => {
  it("202 with { rating, comment } and publishes the comment", async () => {
    publishMock.mockClear();
    const res = await app.inject({ method: "PATCH", url: `/v1/works/contractors/${CONTRACTOR_ID}/rate`, headers: authHeader(["works_admin"]), payload: { rating: 4, comment: "solid delivery on time" } });
    expect(res.statusCode).toBe(202);
    const published = publishMock.mock.calls.find((c) => String(c[0]).includes("contractor.rate"));
    expect(published?.[1]?.payload?.comment).toBe("solid delivery on time");
  });
  it("still accepts a bare { rating } (backward compatible)", async () => {
    const res = await app.inject({ method: "PATCH", url: `/v1/works/contractors/${CONTRACTOR_ID}/rate`, headers: authHeader(["works_admin"]), payload: { rating: 5 } });
    expect(res.statusCode).toBe(202);
  });
  it("400 on an out-of-range rating", async () => {
    const res = await app.inject({ method: "PATCH", url: `/v1/works/contractors/${CONTRACTOR_ID}/rate`, headers: authHeader(["works_admin"]), payload: { rating: 9 } });
    expect(res.statusCode).toBe(400);
  });
});

// ── GAP-WORKS-CONTRACTORS-DETAIL-02: audited PAN reveal ─────────────────────
describe("POST /v1/works/contractors/:id/reveal-pan (GAP-DETAIL-02)", () => {
  it("403 for a read-only role (reveal is write-tier only)", async () => {
    const res = await app.inject({ method: "POST", url: `/v1/works/contractors/${CONTRACTOR_ID}/reveal-pan`, headers: authHeader(["works_viewer"]), payload: { reason: "verify TDS" } });
    expect(res.statusCode).toBe(403);
  });
  it("403 for works_operator (write-tier but not entitled to unmasked PAN)", async () => {
    const res = await app.inject({ method: "POST", url: `/v1/works/contractors/${CONTRACTOR_ID}/reveal-pan`, headers: authHeader(["works_operator"]), payload: { reason: "verify TDS on RA bill" } });
    expect(res.statusCode).toBe(403);
  });
  it("400 when the reason is missing/too short", async () => {
    const res = await app.inject({ method: "POST", url: `/v1/works/contractors/${CONTRACTOR_ID}/reveal-pan`, headers: authHeader(["works_admin"]), payload: { reason: "x" } });
    expect(res.statusCode).toBe(400);
  });
  it("200 returns the clear PAN and records an audit event (never the value)", async () => {
    enqueueMock.mockClear();
    const res = await app.inject({ method: "POST", url: `/v1/works/contractors/${CONTRACTOR_ID}/reveal-pan`, headers: authHeader(["works_admin"]), payload: { reason: "verify TDS on RA bill" } });
    expect(res.statusCode).toBe(200);
    expect(res.json().data.value).toBe("AAAPZ1234C");
    const audit = enqueueMock.mock.calls.at(-1)?.[1];
    expect(audit?.payload?.action).toBe("reveal_pan");
    expect(audit?.payload?.reason).toBe("verify TDS on RA bill");
    expect(JSON.stringify(audit)).not.toContain("AAAPZ1234C");
  });
});
