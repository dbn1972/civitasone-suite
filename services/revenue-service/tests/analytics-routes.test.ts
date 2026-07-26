/**
 * Analytics routes — HTTP integration (SVC-140).
 *
 * Covers RBAC (200/401/403), string-serialised money, forecast happy path +
 * persistence, and validation errors. Repo/commands are mocked so the test
 * exercises the route/serialisation layer with the real forecast domain.
 */
import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";
import type { FastifyInstance } from "fastify";
import { signToken } from "@civitasone/auth";

const SECRET = "test_secret_for_civitasone_32chr";
const TENANT_ID = "t1111111-1111-1111-1111-111111111111";
const USER_ID = "u1111111-1111-1111-1111-111111111111";

function makeToken(roles: string[]) {
  return signToken({ sub: USER_ID, tid: TENANT_ID, roles, sid: "s1" }, SECRET, 3600);
}
const AUTH = { authorization: `Bearer ${makeToken(["revenue_analyst"])}` };
const BAD_ROLE = { authorization: `Bearer ${makeToken(["employee"])}` };

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

vi.mock("../src/modules/analytics/repo.js", () => ({
  getTrends: vi.fn(async () => [
    { period: "2024-04", demandMinor: 100000n, collectionMinor: 60000n, efficiencyBps: 6000 },
  ]),
  getEfficiency: vi.fn(async () => ({
    totalDemandMinor: 100000n,
    totalCollectionMinor: 60000n,
    efficiencyBps: 6000,
    perPeriod: [{ period: "2024-04", demandMinor: 100000n, collectionMinor: 60000n, efficiencyBps: 6000 }],
  })),
  getArrearsAging: vi.fn(async () => ({ bucket0_30: "0", bucket31_60: "150000", bucket61_90: "40000", bucket90Plus: "0" })),
  getDefaulters: vi.fn(async () => [{ assesseeId: "as2", outstandingMinor: 150000n, rank: 1 }]),
  getCollectionSeries: vi.fn(async () => [100000n, 200000n, 300000n]),
}));

const persistForecastRun = vi.fn(async () => ({ id: "run-9" }));
vi.mock("../src/modules/analytics/commands.js", () => ({ persistForecastRun }));

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

describe("GET /v1/revenue/analytics/trends", () => {
  it("returns 200 with string-serialised money", async () => {
    const res = await app.inject({ method: "GET", url: "/v1/revenue/analytics/trends", headers: AUTH });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.data[0]).toEqual({ period: "2024-04", demandMinor: "100000", collectionMinor: "60000", efficiencyBps: 6000 });
    expect(body.meta.granularity).toBe("month");
  });
  it("honours the granularity query param", async () => {
    const res = await app.inject({ method: "GET", url: "/v1/revenue/analytics/trends?granularity=fy", headers: AUTH });
    expect(res.statusCode).toBe(200);
    expect(res.json().meta.granularity).toBe("fy");
  });
  it("returns 401 without auth", async () => {
    const res = await app.inject({ method: "GET", url: "/v1/revenue/analytics/trends" });
    expect(res.statusCode).toBe(401);
  });
  it("returns 403 with wrong role", async () => {
    const res = await app.inject({ method: "GET", url: "/v1/revenue/analytics/trends", headers: BAD_ROLE });
    expect(res.statusCode).toBe(403);
  });
});

describe("GET /v1/revenue/analytics/efficiency", () => {
  it("returns overall + per-period KPIs as strings", async () => {
    const res = await app.inject({ method: "GET", url: "/v1/revenue/analytics/efficiency", headers: AUTH });
    expect(res.statusCode).toBe(200);
    const d = res.json().data;
    expect(d.totalDemandMinor).toBe("100000");
    expect(d.totalCollectionMinor).toBe("60000");
    expect(d.efficiencyBps).toBe(6000);
    expect(d.perPeriod[0].collectionMinor).toBe("60000");
  });
});

describe("GET /v1/revenue/analytics/arrears-aging", () => {
  it("returns buckets and defaults asOf to today", async () => {
    const res = await app.inject({ method: "GET", url: "/v1/revenue/analytics/arrears-aging", headers: AUTH });
    expect(res.statusCode).toBe(200);
    expect(res.json().data.bucket31_60).toBe("150000");
    expect(res.json().meta.asOf).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });
  it("accepts an explicit asOf date", async () => {
    const res = await app.inject({ method: "GET", url: "/v1/revenue/analytics/arrears-aging?asOf=2024-07-01", headers: AUTH });
    expect(res.statusCode).toBe(200);
    expect(res.json().meta.asOf).toBe("2024-07-01");
  });
  it("rejects a malformed asOf date", async () => {
    const res = await app.inject({ method: "GET", url: "/v1/revenue/analytics/arrears-aging?asOf=2024/07/01", headers: AUTH });
    expect(res.statusCode).toBe(400);
  });
});

describe("GET /v1/revenue/analytics/defaulters", () => {
  it("returns ranked defaulters", async () => {
    const res = await app.inject({ method: "GET", url: "/v1/revenue/analytics/defaulters?limit=5", headers: AUTH });
    expect(res.statusCode).toBe(200);
    expect(res.json().data[0]).toEqual({ rank: 1, assesseeId: "as2", outstandingMinor: "150000" });
    expect(res.json().meta.limit).toBe(5);
  });
});

describe("POST /v1/revenue/analytics/forecast", () => {
  it("returns a deterministic projection (straight_line) without persistence", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/v1/revenue/analytics/forecast",
      headers: AUTH,
      payload: { method: "straight_line", horizon: 2 },
    });
    expect(res.statusCode).toBe(200);
    const d = res.json().data;
    expect(d.method).toBe("straight_line");
    expect(d.projections.map((p: any) => p.projectionMinor)).toEqual(["400000", "500000"]);
    expect(d.series).toEqual(["100000", "200000", "300000"]);
    expect(d.runId).toBeUndefined();
    expect(persistForecastRun).not.toHaveBeenCalled();
  });

  it("persists the run when persist=true and returns runId", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/v1/revenue/analytics/forecast",
      headers: AUTH,
      payload: { method: "moving_average", horizon: 1, param: 2, persist: true },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().data.runId).toBe("run-9");
    expect(persistForecastRun).toHaveBeenCalledTimes(1);
  });

  it("defaults method/horizon on an empty body", async () => {
    const res = await app.inject({ method: "POST", url: "/v1/revenue/analytics/forecast", headers: AUTH, payload: {} });
    expect(res.statusCode).toBe(200);
    expect(res.json().data.method).toBe("moving_average");
  });

  it("returns 422 when history is insufficient", async () => {
    const repo = await import("../src/modules/analytics/repo.js");
    (repo.getCollectionSeries as any).mockResolvedValueOnce([100000n]);
    const res = await app.inject({ method: "POST", url: "/v1/revenue/analytics/forecast", headers: AUTH, payload: { method: "straight_line" } });
    expect(res.statusCode).toBe(422);
    expect(res.json().error.code).toBe("INSUFFICIENT_HISTORY");
  });

  it("returns 400 on an invalid method", async () => {
    const res = await app.inject({ method: "POST", url: "/v1/revenue/analytics/forecast", headers: AUTH, payload: { method: "arima" } });
    expect(res.statusCode).toBe(400);
  });

  it("returns 401 without auth", async () => {
    const res = await app.inject({ method: "POST", url: "/v1/revenue/analytics/forecast", payload: {} });
    expect(res.statusCode).toBe(401);
  });

  it("returns 403 with wrong role", async () => {
    const res = await app.inject({ method: "POST", url: "/v1/revenue/analytics/forecast", headers: BAD_ROLE, payload: {} });
    expect(res.statusCode).toBe(403);
  });
});
