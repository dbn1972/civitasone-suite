/**
 * GAP-REVENUE-RECOVERY-02 + GAP-REVENUE-INSTALMENTS-02 — route tests for the
 * two new read endpoints:
 *   GET /v1/revenue/recovery-referrals        (the recovery register)
 *   GET /v1/revenue/instalments/:id           (plan + schedule detail)
 *
 * Follows the same mocked-repo/db pattern as arrears-routes.test.ts (route
 * shape, auth, tenant-scoping) without a live DB. Kept in a separate file so
 * concurrent edits to arrears-routes.test.ts don't collide.
 */
import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";
import type { FastifyInstance } from "fastify";
import { signToken } from "@civitasone/auth";

const SECRET = process.env.JWT_SECRET ?? "test_secret_for_civitasone_32chr";
const TENANT_ID = "t1111111-1111-1111-1111-111111111111";
const TENANT_B_ID = "t9999999-9999-9999-9999-999999999999";
const USER_ID = "u1111111-1111-1111-1111-111111111111";
const ASSESSEE_ID = "a2222222-2222-2222-2222-222222222222";
const PLAN_ID = "44444444-4444-4444-4444-444444444444";

function makeToken(roles: string[], tenantId: string = TENANT_ID) {
  return signToken({ sub: USER_ID, tid: tenantId, roles, sid: "s1" }, SECRET, 3600);
}
const AUTH = { authorization: `Bearer ${makeToken(["revenue_admin"])}` };
const BAD_ROLE = { authorization: `Bearer ${makeToken(["employee"])}` };
const AUTH_TENANT_B = { authorization: `Bearer ${makeToken(["revenue_admin"], TENANT_B_ID)}` };

const REFERRAL_STORE: Record<string, Array<Record<string, unknown>>> = {
  [TENANT_ID]: [
    {
      id: "ref-1",
      tenantId: TENANT_ID,
      assesseeId: ASSESSEE_ID,
      reason: "Persistent non-payment beyond 3 years",
      status: "referred",
      referredAt: "2026-01-02T10:00:00.000Z",
      createdBy: USER_ID,
    },
  ],
};

const PLAN_STORE: Record<string, { tenantId: string; [k: string]: unknown }> = {
  [PLAN_ID]: {
    id: PLAN_ID,
    tenantId: TENANT_ID,
    assesseeId: ASSESSEE_ID,
    totalMinor: 100000n,
    instalmentCount: 4,
    startDate: "2026-04-01",
    status: "active",
    schedule: [
      { id: "i1", planId: PLAN_ID, sequenceNo: 1, dueDate: "2026-04-01", amountMinor: 25000n, status: "pending" },
      { id: "i2", planId: PLAN_ID, sequenceNo: 2, dueDate: "2026-05-01", amountMinor: 25000n, status: "pending" },
      { id: "i3", planId: PLAN_ID, sequenceNo: 3, dueDate: "2026-06-01", amountMinor: 25000n, status: "pending" },
      { id: "i4", planId: PLAN_ID, sequenceNo: 4, dueDate: "2026-07-01", amountMinor: 25000n, status: "pending" },
    ],
  },
};

vi.mock("../src/modules/arrears/repo.js", async (importOriginal) => {
  const original = await importOriginal<typeof import("../src/modules/arrears/repo.js")>();
  return {
    ...original,
    // The real repo pushes limit/offset into SQL and returns { rows, total }.
    listRecoveryReferrals: vi.fn(async (tenantId: string, p: { limit: number; offset: number }, assesseeId?: string) => {
      const all = REFERRAL_STORE[tenantId] ?? [];
      const rows = assesseeId ? all.filter((r) => r.assesseeId === assesseeId) : all;
      return { rows: rows.slice(p.offset, p.offset + p.limit), total: rows.length };
    }),
    findInstalmentPlanById: vi.fn(async (tenantId: string, id: string) => {
      const row = PLAN_STORE[id];
      if (!row || row.tenantId !== tenantId) return null;
      return row;
    }),
  };
});

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

describe("GET /v1/revenue/recovery-referrals (register)", () => {
  it("returns 200 with the tenant's referrals (register is readable, not write-only)", async () => {
    const res = await app.inject({ method: "GET", url: "/v1/revenue/recovery-referrals", headers: AUTH });
    expect(res.statusCode).toBe(200);
    const json = res.json();
    expect(json.data).toHaveLength(1);
    expect(json.data[0].assesseeId).toBe(ASSESSEE_ID);
    expect(json.data[0].reason).toBe("Persistent non-payment beyond 3 years");
    expect(json.meta).toHaveProperty("total", 1);
  });

  it("filters by assesseeId when provided", async () => {
    const res = await app.inject({
      method: "GET",
      url: `/v1/revenue/recovery-referrals?assesseeId=${ASSESSEE_ID}`,
      headers: AUTH,
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().data).toHaveLength(1);
  });

  it("is tenant-scoped: another tenant sees none of these referrals", async () => {
    const res = await app.inject({ method: "GET", url: "/v1/revenue/recovery-referrals", headers: AUTH_TENANT_B });
    expect(res.statusCode).toBe(200);
    expect(res.json().data).toHaveLength(0);
  });

  it("returns 400 for an invalid assesseeId filter", async () => {
    const res = await app.inject({ method: "GET", url: "/v1/revenue/recovery-referrals?assesseeId=not-a-uuid", headers: AUTH });
    expect(res.statusCode).toBe(400);
  });

  it("returns 401 without auth", async () => {
    const res = await app.inject({ method: "GET", url: "/v1/revenue/recovery-referrals" });
    expect(res.statusCode).toBe(401);
  });

  it("returns 403 with wrong role", async () => {
    const res = await app.inject({ method: "GET", url: "/v1/revenue/recovery-referrals", headers: BAD_ROLE });
    expect(res.statusCode).toBe(403);
  });
});

describe("GET /v1/revenue/instalments/:id (plan detail + schedule)", () => {
  it("returns 200 with the plan and schedule lines summing to the total", async () => {
    const res = await app.inject({ method: "GET", url: `/v1/revenue/instalments/${PLAN_ID}`, headers: AUTH });
    expect(res.statusCode).toBe(200);
    const json = res.json();
    expect(json.data.id).toBe(PLAN_ID);
    expect(json.data.schedule).toHaveLength(4);
    const sum = json.data.schedule.reduce((a: bigint, s: { amountMinor: string }) => a + BigInt(s.amountMinor), 0n);
    expect(sum.toString()).toBe(String(json.data.totalMinor));
  });

  it("returns 404 for an unknown plan id", async () => {
    const res = await app.inject({
      method: "GET",
      url: "/v1/revenue/instalments/55555555-5555-5555-5555-555555555555",
      headers: AUTH,
    });
    expect(res.statusCode).toBe(404);
    expect(res.json().error.code).toBe("NOT_FOUND");
  });

  it("is tenant-scoped: another tenant gets 404 for this plan", async () => {
    const res = await app.inject({ method: "GET", url: `/v1/revenue/instalments/${PLAN_ID}`, headers: AUTH_TENANT_B });
    expect(res.statusCode).toBe(404);
  });

  it("returns 400 with invalid UUID param", async () => {
    const res = await app.inject({ method: "GET", url: "/v1/revenue/instalments/not-a-uuid", headers: AUTH });
    expect(res.statusCode).toBe(400);
  });

  it("returns 401 without auth", async () => {
    const res = await app.inject({ method: "GET", url: `/v1/revenue/instalments/${PLAN_ID}` });
    expect(res.statusCode).toBe(401);
  });

  it("returns 403 with wrong role", async () => {
    const res = await app.inject({ method: "GET", url: `/v1/revenue/instalments/${PLAN_ID}`, headers: BAD_ROLE });
    expect(res.statusCode).toBe(403);
  });
});
