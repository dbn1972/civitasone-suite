/**
 * Analytics RLS / tenant-isolation proof (SVC-140).
 *
 * Proves that BOTH the write and read paths of the analytics module are
 * tenant-GUC-backstopped:
 *
 *  WRITE — a persisted forecast run:
 *   1. is stamped with the caller's tenant_id (never another tenant's),
 *   2. is written inside a tenant-scoped transaction whose `app.tenant_id` GUC
 *      is set to that same tenant (the backstop RLS FORCE policy relies on).
 *
 *  READ — the 4 analytics read endpoints (trends/efficiency, aging, defaulters)
 *   3. issue their SELECTs inside a tenant transaction that first sets the
 *      `app.tenant_id` GUC — so the FORCE ROW LEVEL SECURITY backstop is LIVE
 *      on reads, not just the app-layer `eq(tenantId)` predicate,
 *   4. a cross-tenant read cannot see another tenant's rows once the GUC-scoped
 *      (FORCE-RLS-simulating) path filters by the set GUC.
 *
 * The DB-level FORCE ROW LEVEL SECURITY policy is defined in
 * migrations/0002_rls_tenant_isolation.sql / 0003_analytics_forecast_runs.sql;
 * here we verify the application layer that feeds it. The mocked db.transaction
 * captures the set_config target and models RLS by returning ONLY rows whose
 * tenant_id equals the GUC that was set — so a bug that failed to set the GUC,
 * or that read outside the tenant transaction, would surface as a leak here.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

const TENANT_A = "aaaaaaaa-1111-1111-1111-111111111111";
const TENANT_B = "bbbbbbbb-2222-2222-2222-222222222222";

const captured = vi.hoisted(() => ({
  gucTenant: "",
  transactionCount: 0,
  insertedRows: [] as Array<Record<string, unknown>>,
  selectGucs: [] as string[],
}));

// Two-tenant fixtures. The mocked db models FORCE RLS by returning only rows
// whose tenantId matches the GUC that the tenant transaction set.
const store = vi.hoisted(() => ({
  dcb: [] as Array<{ tenantId: string; createdAt: string; demandId: string; entryType: string; amountMinor: bigint }>,
  demands: [] as Array<{ tenantId: string; id: string; assesseeId: string; dueDate: string }>,
}));

vi.mock("../src/shared/infra.js", () => ({
  cache: { getOrLoad: (_k: string, fn: () => Promise<unknown>) => fn() },
  queue: { publish: vi.fn(), subscribe: vi.fn(), start: vi.fn(), stop: vi.fn(), healthCheck: vi.fn() },
}));

vi.mock("../src/shared/db.js", () => {
  const db = {
    transaction: async (fn: (tx: unknown) => Promise<unknown>) => {
      captured.transactionCount++;
      const tx = {
        // setTenantGuc runs: SELECT set_config('app.tenant_id', <uuid>, true).
        // Scan the serialised statement for the UUID param to prove the GUC target.
        execute: async (q: unknown) => {
          const m = JSON.stringify(q).match(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i);
          if (m) captured.gucTenant = m[0];
        },
        // Model FORCE RLS: a SELECT only sees rows for the tenant whose GUC is
        // currently set. If the GUC was never set (empty), nothing is visible.
        select: (proj: Record<string, unknown>) => ({
          from: () => ({
            where: async () => {
              const guc = captured.gucTenant;
              captured.selectGucs.push(guc);
              const isDcb = !!proj && ("entryType" in proj || "demandId" in proj || "amountMinor" in proj);
              return isDcb
                ? store.dcb.filter((r) => r.tenantId === guc)
                : store.demands.filter((r) => r.tenantId === guc);
            },
          }),
        }),
        insert: () => ({
          values: (row: Record<string, unknown>) => {
            captured.insertedRows.push(row);
            return { returning: async () => [{ id: "run-1" }] };
          },
        }),
      };
      return fn(tx);
    },
  };
  return { db, sqlClient: { end: vi.fn() }, dbFor: vi.fn(), sqlClientFor: vi.fn(), tierOf: vi.fn(), dbForRead: vi.fn() };
});

import * as commands from "../src/modules/analytics/commands.js";
import * as repo from "../src/modules/analytics/repo.js";
import { forecast } from "../src/modules/analytics/domain.js";

function ctxFor(tid: string) {
  return { actorId: "cccccccc-3333-3333-3333-333333333333", tenantId: tid, roles: [], sessionId: "", correlationId: "c" };
}

function seedBothTenants() {
  store.dcb = [
    // tenant A: demand 100000, collection 40000 => outstanding 60000
    { tenantId: TENANT_A, createdAt: "2024-04-10T00:00:00Z", demandId: "dA1", entryType: "demand", amountMinor: 100000n },
    { tenantId: TENANT_A, createdAt: "2024-04-15T00:00:00Z", demandId: "dA1", entryType: "collection", amountMinor: 40000n },
    // tenant B: demand 900000, collection 0 => outstanding 900000
    { tenantId: TENANT_B, createdAt: "2024-04-11T00:00:00Z", demandId: "dB1", entryType: "demand", amountMinor: 900000n },
  ];
  store.demands = [
    { tenantId: TENANT_A, id: "dA1", assesseeId: "assessee-A", dueDate: "2024-04-30" },
    { tenantId: TENANT_B, id: "dB1", assesseeId: "assessee-B", dueDate: "2024-04-30" },
  ];
}

beforeEach(() => {
  captured.gucTenant = "";
  captured.transactionCount = 0;
  captured.insertedRows = [];
  captured.selectGucs = [];
  store.dcb = [];
  store.demands = [];
});

describe("forecast run tenant isolation (write path)", () => {
  const result = forecast([100n, 200n, 300n], "straight_line", 1);

  it("stamps the row with tenant A and sets the GUC to tenant A", async () => {
    await commands.persistForecastRun(ctxFor(TENANT_A), {
      method: "straight_line",
      granularity: "month",
      param: 3,
      series: [100n, 200n, 300n],
      result,
    });
    expect(captured.insertedRows[0]!.tenantId).toBe(TENANT_A);
    expect(captured.gucTenant).toBe(TENANT_A);
    expect(captured.transactionCount).toBe(1);
  });

  it("never cross-stamps: tenant B run carries tenant B only", async () => {
    await commands.persistForecastRun(ctxFor(TENANT_B), {
      method: "straight_line",
      granularity: "month",
      param: 3,
      series: [100n, 200n, 300n],
      result,
    });
    expect(captured.insertedRows[0]!.tenantId).toBe(TENANT_B);
    expect(captured.insertedRows[0]!.tenantId).not.toBe(TENANT_A);
    expect(captured.gucTenant).toBe(TENANT_B);
  });
});

describe("analytics read tenant isolation (read path — GUC backstop)", () => {
  it("getTrends read runs inside a tenant transaction that sets app.tenant_id", async () => {
    seedBothTenants();
    await repo.getTrends(TENANT_A, "month");
    // The SELECT must have run inside a transaction (loadDcbRows) …
    expect(captured.transactionCount).toBe(1);
    // … whose GUC was set to the caller's tenant before the read executed …
    expect(captured.gucTenant).toBe(TENANT_A);
    // … and every SELECT observed that GUC (never an empty / unset GUC).
    expect(captured.selectGucs.length).toBeGreaterThan(0);
    expect(captured.selectGucs.every((g) => g === TENANT_A)).toBe(true);
  });

  it("getArrearsAging sets the GUC for both of its SELECTs", async () => {
    seedBothTenants();
    await repo.getArrearsAging(TENANT_A, "2024-07-01");
    expect(captured.gucTenant).toBe(TENANT_A);
    // demands + dcb SELECTs, both under the same tenant GUC
    expect(captured.selectGucs).toEqual([TENANT_A, TENANT_A]);
  });

  it("getDefaulters for tenant A cannot see tenant B rows on the FORCE-RLS path", async () => {
    seedBothTenants();
    const defA = await repo.getDefaulters(TENANT_A, 10);
    expect(captured.gucTenant).toBe(TENANT_A);
    expect(defA).toEqual([{ assesseeId: "assessee-A", outstandingMinor: 60000n, rank: 1 }]);
    // No tenant-B assessee leaks through the GUC-scoped read.
    expect(defA.some((d) => d.assesseeId === "assessee-B")).toBe(false);
  });

  it("getDefaulters for tenant B sees only tenant B (mirror check)", async () => {
    seedBothTenants();
    const defB = await repo.getDefaulters(TENANT_B, 10);
    expect(captured.gucTenant).toBe(TENANT_B);
    expect(defB).toEqual([{ assesseeId: "assessee-B", outstandingMinor: 900000n, rank: 1 }]);
    expect(defB.some((d) => d.assesseeId === "assessee-A")).toBe(false);
  });
});
