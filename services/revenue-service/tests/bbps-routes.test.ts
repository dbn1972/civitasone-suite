/**
 * BBPS module — route-level integration tests.
 *
 * Covers: POST /bbps/fetch-bill 202, POST /bbps/pay-bill 202,
 * BBPS_DISABLED guard (403), 400/401 error paths.
 *
 * SEC-001: also covers the pay-bill authorization gate, added after this
 * route was found to accept fully client-fabricated payments (any
 * authenticated user, wrote a real receipt + DCB collection + GL event).
 * See the sec-001 describe block below.
 *
 * An earlier version of this fix additionally required an x-bbps-signature
 * HMAC header on this route (verifyBbpsCallback), tested here. That has been
 * removed: the real caller is PayBillForm.tsx, a staff browser form with no
 * access to (and no business having) the signing secret, so requiring it
 * made every real call 400. See routes.ts's SEC-001 comment for the full
 * reasoning. Replay/duplicate protection for this route now lives at the DB
 * layer (migrations/0006_bbps_replay_protection.sql) and is covered in
 * bbps-consumer.test.ts, not here.
 */
import { describe, it, expect, beforeAll, afterAll, beforeEach, afterEach, vi } from "vitest";
import type { FastifyInstance } from "fastify";
import { signToken } from "@civitasone/auth";

const SECRET = "test_secret_for_civitasone_32chr";
const TENANT_ID = "t1111111-1111-1111-1111-111111111111";
const USER_ID = "u1111111-1111-1111-1111-111111111111";

function makeToken(roles: string[]) {
  return signToken({ sub: USER_ID, tid: TENANT_ID, roles, sid: "s1" }, SECRET, 3600);
}

const AUTH = { authorization: `Bearer ${makeToken(["revenue_admin"])}` };
const UNPRIVILEGED_AUTH = { authorization: `Bearer ${makeToken(["hrms_employee"])}` };

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

const publishSpy = vi.fn().mockResolvedValue(undefined);

vi.mock("../src/shared/infra.js", () => ({
  cache: {
    put: vi.fn().mockResolvedValue(undefined),
    get: vi.fn().mockResolvedValue(null),
    getOrLoad: vi.fn().mockResolvedValue([]),
    invalidate: vi.fn().mockResolvedValue(undefined),
  },
  queue: {
    publish: (...args: unknown[]) => publishSpy(...args),
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

// ── SEC-001 regression: pay-bill authorization gate ───────────────────────────
//
// Prior to this fix, POST /v1/revenue/bbps/pay-bill accepted client-supplied
// assesseeIdentifier/amountMinor/bbpsTxnId from ANY authenticated user with NO
// role check and NO proof a real BBPS payment occurred, then published the
// command straight to the consumer which wrote a receipt + DCB collection +
// bbps_transaction(success) row and enqueued a GL-bound receiptCaptured event.
//
// These tests prove: a caller lacking a revenue/collection role is rejected,
// and in that rejection case NOTHING is published to the queue — so the
// consumer never runs and no receipt/DCB/bbps_transaction/event row is ever
// written. A caller WITH a revenue/collection role is accepted and the
// command is published — this route does not (and, absent a real BBPS
// gateway integration, cannot) cryptographically prove a real payment
// occurred; see routes.ts's SEC-001 comment for that residual limitation and
// consumer.ts / bbps-consumer.test.ts for the separate replay/duplicate
// protection this fix also adds.

describe("SEC-001: POST /v1/revenue/bbps/pay-bill authorization gate (BBPS_ENABLED=true)", () => {
  const payload = { assesseeIdentifier: "PROP-001", amountMinor: "200000", bbpsTxnId: "BBPS-TXN-001", channel: "bbps" };

  beforeEach(() => {
    process.env.BBPS_ENABLED = "true";
    publishSpy.mockClear();
  });

  afterEach(() => {
    delete process.env.BBPS_ENABLED;
  });

  it("rejects a caller with no revenue/collection role — no command published", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/v1/revenue/bbps/pay-bill",
      headers: UNPRIVILEGED_AUTH,
      payload,
    });
    expect(res.statusCode).toBe(403);
    expect(res.json().error.code).toBe("FORBIDDEN");
    expect(publishSpy).not.toHaveBeenCalled();
  });

  it("accepts a revenue_admin request — publishes the command", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/v1/revenue/bbps/pay-bill",
      headers: AUTH,
      payload,
    });
    expect(res.statusCode).toBe(202);
    expect(publishSpy).toHaveBeenCalledTimes(1);
  });
});
