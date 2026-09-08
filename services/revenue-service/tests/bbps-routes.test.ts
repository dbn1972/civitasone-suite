/**
 * BBPS module — route-level integration tests.
 *
 * Covers: POST /bbps/fetch-bill 202, POST /bbps/pay-bill 202,
 * BBPS_DISABLED guard (403), 400/401 error paths.
 *
 * SEC-001: also covers the pay-bill authorization gate — role check +
 * BBPS gateway signature — added after this route was found to accept
 * fully client-fabricated payments (any authenticated user, no signature,
 * wrote a real receipt + DCB collection + GL event). See sec-001-*
 * describe blocks below.
 */
import { describe, it, expect, beforeAll, afterAll, beforeEach, afterEach, vi } from "vitest";
import type { FastifyInstance } from "fastify";
import { createHmac } from "node:crypto";
import { signToken } from "@civitasone/auth";

const SECRET = "test_secret_for_civitasone_32chr";
const TENANT_ID = "t1111111-1111-1111-1111-111111111111";
const USER_ID = "u1111111-1111-1111-1111-111111111111";
const BBPS_WEBHOOK_SECRET = "bbps_test_webhook_secret_32char";

function makeToken(roles: string[]) {
  return signToken({ sub: USER_ID, tid: TENANT_ID, roles, sid: "s1" }, SECRET, 3600);
}

function signBbps(payload: unknown): string {
  return createHmac("sha256", BBPS_WEBHOOK_SECRET).update(JSON.stringify(payload)).digest("hex");
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
// These tests prove: (a) a caller lacking a revenue/collection role is
// rejected even with a perfectly valid signature, (b) a caller with the
// right role but no/invalid BBPS signature is rejected, and in every
// rejection case NOTHING is published to the queue — so the consumer never
// runs and no receipt/DCB/bbps_transaction/event row is ever written.

describe("SEC-001: POST /v1/revenue/bbps/pay-bill authorization gate (BBPS_ENABLED=true)", () => {
  const payload = { assesseeIdentifier: "PROP-001", amountMinor: "200000", bbpsTxnId: "BBPS-TXN-001", channel: "bbps" };

  beforeEach(() => {
    process.env.BBPS_ENABLED = "true";
    process.env.BBPS_WEBHOOK_SECRET = BBPS_WEBHOOK_SECRET;
    publishSpy.mockClear();
  });

  afterEach(() => {
    delete process.env.BBPS_ENABLED;
    delete process.env.BBPS_WEBHOOK_SECRET;
  });

  it("rejects a caller with no revenue/collection role, even with a correctly signed payload — no command published", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/v1/revenue/bbps/pay-bill",
      headers: { ...UNPRIVILEGED_AUTH, "x-bbps-signature": signBbps(payload) },
      payload,
    });
    expect(res.statusCode).toBe(403);
    expect(res.json().error.code).toBe("FORBIDDEN");
    expect(publishSpy).not.toHaveBeenCalled();
  });

  it("rejects a revenue_admin request with no x-bbps-signature header — no command published", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/v1/revenue/bbps/pay-bill",
      headers: AUTH,
      payload,
    });
    expect(res.statusCode).toBe(400);
    expect(res.json().error.code).toBe("MISSING_SIGNATURE");
    expect(publishSpy).not.toHaveBeenCalled();
  });

  it("SEC-001 regression: rejects a revenue_admin request with a forged x-bbps-signature — no command published", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/v1/revenue/bbps/pay-bill",
      headers: { ...AUTH, "x-bbps-signature": "deadbeef".repeat(8) },
      payload,
    });
    expect(res.statusCode).toBe(400);
    expect(res.json().error.code).toBe("INVALID_BBPS_SIGNATURE");
    expect(publishSpy).not.toHaveBeenCalled();
  });

  it("rejects a signature computed with the wrong secret — no command published", async () => {
    const wrongSignature = createHmac("sha256", "not-the-real-secret-at-all-32ch")
      .update(JSON.stringify(payload))
      .digest("hex");
    const res = await app.inject({
      method: "POST",
      url: "/v1/revenue/bbps/pay-bill",
      headers: { ...AUTH, "x-bbps-signature": wrongSignature },
      payload,
    });
    expect(res.statusCode).toBe(400);
    expect(res.json().error.code).toBe("INVALID_BBPS_SIGNATURE");
    expect(publishSpy).not.toHaveBeenCalled();
  });

  it("accepts a revenue_admin request with a valid role AND a valid BBPS signature — publishes the command", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/v1/revenue/bbps/pay-bill",
      headers: { ...AUTH, "x-bbps-signature": signBbps(payload) },
      payload,
    });
    expect(res.statusCode).toBe(202);
    expect(publishSpy).toHaveBeenCalledTimes(1);
  });
});
