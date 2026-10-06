/**
 * GAP-REVENUE-REFUNDS-01 — route tests for the refund register list endpoint
 *   GET /v1/revenue/refunds[?status=pending]
 *
 * Mirrors the mocked-repo/db pattern of collection-routes.test.ts (route
 * shape, auth, status filter, tenant-scoping) without a live DB. Separate file
 * so concurrent edits to collection-routes.test.ts don't collide.
 */
import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";
import type { FastifyInstance } from "fastify";
import { signToken } from "@civitasone/auth";

const SECRET = process.env.JWT_SECRET ?? "test_secret_for_civitasone_32chr";
const TENANT_ID = "t1111111-1111-1111-1111-111111111111";
const TENANT_B_ID = "t9999999-9999-9999-9999-999999999999";
const USER_ID = "u1111111-1111-1111-1111-111111111111";
const ASSESSEE_ID = "a2222222-2222-2222-2222-222222222222";
const RECEIPT_ID = "11111111-1111-1111-1111-111111111111";

function makeToken(roles: string[], tenantId: string = TENANT_ID) {
  return signToken({ sub: USER_ID, tid: tenantId, roles, sid: "s1" }, SECRET, 3600);
}
const AUTH = { authorization: `Bearer ${makeToken(["revenue_admin"])}` };
const BAD_ROLE = { authorization: `Bearer ${makeToken(["employee"])}` };
const AUTH_TENANT_B = { authorization: `Bearer ${makeToken(["revenue_admin"], TENANT_B_ID)}` };

const REFUND_STORE: Record<string, Array<Record<string, unknown>>> = {
  [TENANT_ID]: [
    {
      id: "rf-1",
      tenantId: TENANT_ID,
      receiptId: RECEIPT_ID,
      assesseeId: ASSESSEE_ID,
      amountMinor: 250000n,
      reason: "Duplicate payment",
      status: "pending",
      makerUserId: "maker-1",
      createdAt: "2026-02-01T10:00:00.000Z",
    },
    {
      id: "rf-2",
      tenantId: TENANT_ID,
      receiptId: RECEIPT_ID,
      assesseeId: ASSESSEE_ID,
      amountMinor: 100000n,
      reason: "Overpayment",
      status: "approved",
      makerUserId: "maker-1",
      createdAt: "2026-01-01T10:00:00.000Z",
    },
  ],
};

vi.mock("../src/modules/collection/repo.js", async (importOriginal) => {
  const original = await importOriginal<typeof import("../src/modules/collection/repo.js")>();
  return {
    ...original,
    // The real repo pushes limit/offset into SQL and returns { rows, total }.
    listRefunds: vi.fn(async (tenantId: string, p: { limit: number; offset: number }, status?: string) => {
      const all = REFUND_STORE[tenantId] ?? [];
      const rows = status ? all.filter((r) => r.status === status) : all;
      return { rows: rows.slice(p.offset, p.offset + p.limit), total: rows.length };
    }),
  };
});

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

let app: FastifyInstance;
beforeAll(async () => {
  const { buildApp } = await import("../src/app.js");
  app = await buildApp();
  await app.ready();
});
afterAll(async () => {
  await app.close();
});

describe("GET /v1/revenue/refunds (register)", () => {
  it("returns 200 with all of the tenant's refunds (checker can discover without a UUID)", async () => {
    const res = await app.inject({ method: "GET", url: "/v1/revenue/refunds", headers: AUTH });
    expect(res.statusCode).toBe(200);
    expect(res.json().data).toHaveLength(2);
  });

  it("filters to only status=pending", async () => {
    const res = await app.inject({ method: "GET", url: "/v1/revenue/refunds?status=pending", headers: AUTH });
    expect(res.statusCode).toBe(200);
    const data = res.json().data;
    expect(data).toHaveLength(1);
    expect(data[0].status).toBe("pending");
    expect(data[0].reason).toBe("Duplicate payment");
  });

  it("is tenant-scoped: another tenant sees none of these refunds", async () => {
    const res = await app.inject({ method: "GET", url: "/v1/revenue/refunds", headers: AUTH_TENANT_B });
    expect(res.statusCode).toBe(200);
    expect(res.json().data).toHaveLength(0);
  });

  it("returns 400 for an invalid status filter", async () => {
    const res = await app.inject({ method: "GET", url: "/v1/revenue/refunds?status=bogus", headers: AUTH });
    expect(res.statusCode).toBe(400);
  });

  it("returns 401 without auth", async () => {
    const res = await app.inject({ method: "GET", url: "/v1/revenue/refunds" });
    expect(res.statusCode).toBe(401);
  });

  it("returns 403 with wrong role", async () => {
    const res = await app.inject({ method: "GET", url: "/v1/revenue/refunds", headers: BAD_ROLE });
    expect(res.statusCode).toBe(403);
  });
});
