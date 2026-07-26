/**
 * Analytics RLS / tenant-isolation proof (SVC-140).
 *
 * Proves that a persisted forecast run:
 *  1. is stamped with the caller's tenant_id (never another tenant's),
 *  2. is written inside a tenant-scoped transaction whose `app.tenant_id` GUC
 *     is set to that same tenant (the backstop RLS FORCE policy relies on).
 *
 * The DB-level FORCE ROW LEVEL SECURITY policy is defined in
 * migrations/0003_analytics_forecast_runs.sql; here we verify the application
 * layer that feeds it.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

const captured = vi.hoisted(() => ({
  gucTenant: "",
  transactionCount: 0,
  insertedRows: [] as Array<Record<string, unknown>>,
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
import { forecast } from "../src/modules/analytics/domain.js";

const TENANT_A = "aaaaaaaa-1111-1111-1111-111111111111";
const TENANT_B = "bbbbbbbb-2222-2222-2222-222222222222";
function ctxFor(tid: string) {
  return { actorId: "cccccccc-3333-3333-3333-333333333333", tenantId: tid, roles: [], sessionId: "", correlationId: "c" };
}

beforeEach(() => {
  captured.gucTenant = "";
  captured.transactionCount = 0;
  captured.insertedRows = [];
});

describe("forecast run tenant isolation", () => {
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
