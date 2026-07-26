/**
 * Analytics repo tests (SVC-140) — pure row-transformation helpers plus the
 * DB read/write model exercised against a mocked drizzle db and cache.
 */
import { describe, it, expect, vi } from "vitest";

const rows = vi.hoisted(() => ({
  dcb: [] as Array<Record<string, unknown>>,
  demands: [] as Array<Record<string, unknown>>,
}));

vi.mock("../src/shared/infra.js", () => ({
  // memory-like cache that always invokes the loader
  cache: { getOrLoad: (_k: string, fn: () => Promise<unknown>) => fn() },
  queue: { publish: vi.fn(), subscribe: vi.fn(), start: vi.fn(), stop: vi.fn(), healthCheck: vi.fn() },
}));

vi.mock("../src/shared/db.js", () => {
  const db = {
    select: (proj: Record<string, unknown>) => ({
      from: () => ({
        where: async () => (proj && "entryType" in proj ? rows.dcb : rows.demands),
      }),
    }),
    transaction: async (fn: (tx: unknown) => Promise<unknown>) => {
      // Reads now run inside the tenant transaction (GUC backstop). The tx must
      // therefore expose the same select() surface as the top-level db.
      const tx = {
        execute: async () => undefined,
        select: (proj: Record<string, unknown>) => ({
          from: () => ({
            where: async () => (proj && "entryType" in proj ? rows.dcb : rows.demands),
          }),
        }),
        insert: () => ({ values: () => ({ returning: async () => [{ id: "run-1" }] }) }),
      };
      return fn(tx);
    },
  };
  return { db, sqlClient: { end: vi.fn() }, dbFor: vi.fn(), sqlClientFor: vi.fn(), tierOf: vi.fn(), dbForRead: vi.fn() };
});

import * as repo from "../src/modules/analytics/repo.js";
import * as commands from "../src/modules/analytics/commands.js";
import { forecast } from "../src/modules/analytics/domain.js";

const TENANT = "11111111-1111-1111-1111-111111111111";
const CTX = { actorId: "22222222-2222-2222-2222-222222222222", tenantId: TENANT, roles: [], sessionId: "", correlationId: "c" };

function seed() {
  rows.dcb = [
    { createdAt: "2024-04-10T00:00:00Z", demandId: "d1", entryType: "demand", amountMinor: 100000n },
    { createdAt: "2024-04-15T00:00:00Z", demandId: "d1", entryType: "collection", amountMinor: 60000n },
    { createdAt: "2024-05-05T00:00:00Z", demandId: "d2", entryType: "demand", amountMinor: 200000n },
    { createdAt: "2024-05-20T00:00:00Z", demandId: "d2", entryType: "collection", amountMinor: 50000n },
  ];
  rows.demands = [
    { id: "d1", assesseeId: "as1", dueDate: "2024-04-30" },
    { id: "d2", assesseeId: "as2", dueDate: "2024-05-31" },
  ];
}

describe("pure helpers", () => {
  it("periodKey — month", () => {
    expect(repo.periodKey("2024-04-10T00:00:00Z", "month")).toBe("2024-04");
    expect(repo.periodKey(new Date("2024-12-01T00:00:00Z"), "month")).toBe("2024-12");
  });
  it("periodKey — Indian financial year", () => {
    expect(repo.periodKey("2024-03-15T00:00:00Z", "fy")).toBe("2023-2024");
    expect(repo.periodKey("2024-04-01T00:00:00Z", "fy")).toBe("2024-2025");
  });
  it("computeDemandBalances nets demand vs collection per demand", () => {
    const bal = repo.computeDemandBalances([
      { demandId: "d1", entryType: "demand", amountMinor: 100000n },
      { demandId: "d1", entryType: "collection", amountMinor: 60000n },
      { demandId: "d2", entryType: "demand", amountMinor: 200000n },
    ]);
    expect(bal.get("d1")).toBe(40000n);
    expect(bal.get("d2")).toBe(200000n);
  });
  it("outstandingByAssessee rolls demand balances up to assessees", () => {
    const bal = new Map<string, bigint>([["d1", 40000n], ["d2", 150000n]]);
    const out = repo.outstandingByAssessee(
      [{ id: "d1", assesseeId: "as1" }, { id: "d2", assesseeId: "as2" }],
      bal,
    );
    expect(out).toEqual([
      { assesseeId: "as1", outstandingMinor: 40000n },
      { assesseeId: "as2", outstandingMinor: 150000n },
    ]);
  });
  it("toPeriodEntries maps rows to period buckets", () => {
    const e = repo.toPeriodEntries(
      [{ createdAt: "2024-05-05T00:00:00Z", entryType: "collection", amountMinor: 50000n }],
      "month",
    );
    expect(e[0]).toEqual({ period: "2024-05", entryType: "collection", amountMinor: 50000n });
  });
});

describe("DB read models", () => {
  it("getTrends aggregates demand vs collection per month", async () => {
    seed();
    const t = await repo.getTrends(TENANT, "month");
    expect(t).toEqual([
      { period: "2024-04", demandMinor: 100000n, collectionMinor: 60000n, efficiencyBps: 6000 },
      { period: "2024-05", demandMinor: 200000n, collectionMinor: 50000n, efficiencyBps: 2500 },
    ]);
  });

  it("getCollectionSeries returns ascending per-period collections", async () => {
    seed();
    expect(await repo.getCollectionSeries(TENANT, "month")).toEqual([60000n, 50000n]);
  });

  it("getEfficiency totals demand and collection", async () => {
    seed();
    const kpi = await repo.getEfficiency(TENANT, "month");
    expect(kpi.totalDemandMinor).toBe(300000n);
    expect(kpi.totalCollectionMinor).toBe(110000n);
    expect(kpi.efficiencyBps).toBe(3666);
    expect(kpi.perPeriod).toHaveLength(2);
  });

  it("getArrearsAging buckets outstanding by overdue days", async () => {
    seed();
    const aging = await repo.getArrearsAging(TENANT, "2024-07-01");
    expect(aging).toEqual({
      bucket0_30: "0",
      bucket31_60: "150000",
      bucket61_90: "40000",
      bucket90Plus: "0",
    });
  });

  it("getDefaulters ranks assessees by outstanding balance", async () => {
    seed();
    const d = await repo.getDefaulters(TENANT, 10);
    expect(d).toEqual([
      { assesseeId: "as2", outstandingMinor: 150000n, rank: 1 },
      { assesseeId: "as1", outstandingMinor: 40000n, rank: 2 },
    ]);
  });
});

describe("persistForecastRun", () => {
  it("writes a forecast run inside a tenant transaction and returns the id", async () => {
    const result = forecast([100n, 200n, 300n], "straight_line", 2);
    const saved = await commands.persistForecastRun(CTX, {
      method: "straight_line",
      granularity: "month",
      param: 3,
      series: [100n, 200n, 300n],
      result,
    });
    expect(saved).toEqual({ id: "run-1" });
  });
});
