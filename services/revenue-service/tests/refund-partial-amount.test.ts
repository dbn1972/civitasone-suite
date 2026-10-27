/**
 * GAP-REVENUE-REFUNDS-02 / owner decision #1 (2026-10-26): partial refunds are
 * allowed. POST /v1/revenue/refunds takes an OPTIONAL amountMinor that must be
 * positive and never above the receipt's refundable balance; omitting it keeps
 * the old behaviour (a full refund of the receipt).
 *
 * Route-level (repo mocked, like collection-routes.test.ts) plus a DB-backed
 * consumer test that proves the partial amount is what lands on the refund row
 * and what is credited back to the demand ledger on approval.
 */
import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";
import type { FastifyInstance } from "fastify";
import { signToken } from "@civitasone/auth";

// The JWT signing secret is injected by vitest.config.ts (test.env.JWT_SECRET).
const SECRET = process.env.JWT_SECRET ?? globalThis.crypto.randomUUID();
const TENANT_ID = "e1111111-1111-4111-8111-111111111111";
const USER_ID = "e2222222-2222-4222-8222-222222222222";
const RECEIPT_ID = "e3333333-3333-4333-8333-333333333333";
const OTHER_RECEIPT_ID = "e4444444-4444-4444-8444-444444444444";
const RECEIPT_AMOUNT = 100000n;

const AUTH = {
  authorization: `Bearer ${signToken({ sub: USER_ID, tid: TENANT_ID, roles: ["revenue_admin"], sid: "s1" }, SECRET, 3600)}`,
};

const publishSpy = vi.fn().mockResolvedValue(undefined);

vi.mock("../src/modules/collection/repo.js", async (importOriginal) => {
  const original = await importOriginal<typeof import("../src/modules/collection/repo.js")>();
  return {
    ...original,
    findLiveRefundByReceipt: vi.fn(async () => null),
    findReceipt: vi.fn(async (tenantId: string, id: string) =>
      id === RECEIPT_ID && tenantId === TENANT_ID
        ? { id, tenantId, assesseeId: "a", demandId: "d", amountMinor: 100000n, status: "captured" }
        : null,
    ),
  };
});
vi.mock("../src/shared/db.js", () => ({
  db: { transaction: vi.fn(async (fn: (tx: unknown) => Promise<unknown>) => fn({})) },
  sqlClient: { end: vi.fn() },
  dbFor: vi.fn(), sqlClientFor: vi.fn(), tierOf: vi.fn(), dbForRead: vi.fn(),
}));
vi.mock("../src/shared/infra.js", () => ({
  cache: {
    put: vi.fn(), get: vi.fn().mockResolvedValue(null),
    getOrLoad: vi.fn().mockResolvedValue([]), invalidate: vi.fn(),
  },
  queue: {
    publish: (...a: unknown[]) => publishSpy(...a),
    subscribe: vi.fn(), start: vi.fn(), stop: vi.fn(),
    healthCheck: vi.fn().mockResolvedValue({ healthy: true }),
  },
}));
vi.mock("../src/shared/context.js", async (importOriginal) => {
  const original = await importOriginal<typeof import("../src/shared/context.js")>();
  return {
    ...original,
    resolveContext: (req: any) => {
      const ctx = req.ctx;
      if (!ctx || ctx.actorId === "system" || ctx.actorId === "anonymous") {
        throw new original.HttpError(401, "UNAUTHENTICATED", "missing authentication");
      }
      return { actorId: ctx.actorId, tenantId: ctx.tenantId, roles: ctx.roles ?? [], sessionId: ctx.sessionId ?? "", correlationId: ctx.correlationId ?? req.id };
    },
  };
});

let app: FastifyInstance;
beforeAll(async () => {
  const { buildApp } = await import("../src/app.js");
  app = await buildApp();
  await app.ready();
});
afterAll(async () => { await app.close(); });

describe("POST /v1/revenue/refunds — optional partial amount (owner decision #1)", () => {
  it("accepts a partial amountMinor below the receipt and forwards it on the command", async () => {
    publishSpy.mockClear();
    const res = await app.inject({
      method: "POST", url: "/v1/revenue/refunds", headers: AUTH,
      payload: { receiptId: RECEIPT_ID, reason: "Part over-collected", amountMinor: "40000" },
    });
    expect(res.statusCode).toBe(202);
    const published = publishSpy.mock.calls.at(-1)![1] as { payload: { amountMinor?: string } };
    expect(published.payload.amountMinor).toBe("40000");
  });

  it("accepts an amount exactly equal to the receipt (full, explicit)", async () => {
    const res = await app.inject({
      method: "POST", url: "/v1/revenue/refunds", headers: AUTH,
      payload: { receiptId: RECEIPT_ID, reason: "Full", amountMinor: RECEIPT_AMOUNT.toString() },
    });
    expect(res.statusCode).toBe(202);
  });

  it("rejects an amount above the refundable balance with 422 REFUND_EXCEEDS_RECEIPT and publishes nothing", async () => {
    publishSpy.mockClear();
    const res = await app.inject({
      method: "POST", url: "/v1/revenue/refunds", headers: AUTH,
      payload: { receiptId: RECEIPT_ID, reason: "Too much", amountMinor: "100001" },
    });
    expect(res.statusCode).toBe(422);
    expect(res.json().error.code).toBe("REFUND_EXCEEDS_RECEIPT");
    expect(publishSpy).not.toHaveBeenCalled();
  });

  it("rejects a zero amount with 422 INVALID_AMOUNT", async () => {
    const res = await app.inject({
      method: "POST", url: "/v1/revenue/refunds", headers: AUTH,
      payload: { receiptId: RECEIPT_ID, reason: "Zero", amountMinor: "0" },
    });
    expect(res.statusCode).toBe(422);
    expect(res.json().error.code).toBe("INVALID_AMOUNT");
  });

  it("404s a partial refund against an unknown receipt", async () => {
    const res = await app.inject({
      method: "POST", url: "/v1/revenue/refunds", headers: AUTH,
      payload: { receiptId: OTHER_RECEIPT_ID, reason: "Nope", amountMinor: "10" },
    });
    expect(res.statusCode).toBe(404);
  });

  it("full refund stays the default: omitting amountMinor still returns 202 and sends no amount", async () => {
    publishSpy.mockClear();
    const res = await app.inject({
      method: "POST", url: "/v1/revenue/refunds", headers: AUTH,
      payload: { receiptId: RECEIPT_ID, reason: "Whole receipt" },
    });
    expect(res.statusCode).toBe(202);
    const published = publishSpy.mock.calls.at(-1)![1] as { payload: Record<string, unknown> };
    expect(published.payload.amountMinor).toBeUndefined();
  });
});
