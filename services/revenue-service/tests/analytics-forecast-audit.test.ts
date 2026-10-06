/**
 * GAP-REVENUE-ANALYTICS-04: persisting a forecast run is a mutation and must
 * emit an audit event in the same transaction. This pins that behaviour with a
 * fake tenant transaction that records every insert.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

const inserts: Array<{ table: unknown; values: Record<string, unknown> }> = [];

// Fake drizzle tx: insert(table).values(v).returning() records the call.
function makeTx() {
  return {
    insert(table: unknown) {
      return {
        values(v: Record<string, unknown>) {
          inserts.push({ table, values: v });
          return {
            returning: async () => [{ id: "run-123" }],
            // enqueue() awaits insert().values() directly (no .returning()).
            then: (res: (x: unknown) => void) => res(undefined),
          };
        },
      };
    },
  };
}

vi.mock("@civitasone/db", () => ({
  tenantTransaction: async (_db: unknown, _tenant: string, fn: (tx: unknown) => Promise<unknown>) => fn(makeTx()),
}));
vi.mock("../src/shared/db.js", () => ({ db: {} }));
// Use the real @civitasone/outbox enqueue (it just calls tx.insert(...).values(...)).

import { persistForecastRun } from "../src/modules/analytics/commands.js";
import type { ForecastResult } from "../src/modules/analytics/domain.js";

const ctx = {
  actorId: "u-1",
  tenantId: "t-1",
  roles: ["revenue_analyst"],
  sessionId: "s-1",
  correlationId: "c-1",
} as const;

const result: ForecastResult = {
  method: "moving_average",
  historyPeriods: 3,
  horizon: 1,
  madMinor: 0n,
  confidenceBps: 9000,
  projections: [{ index: 0, projectionMinor: 100n, lowerMinor: 90n, upperMinor: 110n }],
} as unknown as ForecastResult;

describe("persistForecastRun audit", () => {
  beforeEach(() => {
    inserts.length = 0;
  });

  it("enqueues an audit.event.record for the persisted forecast run", async () => {
    const out = await persistForecastRun(ctx as never, {
      method: "moving_average",
      granularity: "month",
      param: 3,
      series: [10n, 20n, 30n],
      result,
    });
    expect(out.id).toBe("run-123");
    const auditInsert = inserts.find((i) => (i.values as { topic?: string }).topic === "audit.event.record");
    expect(auditInsert, "an audit.event.record outbox row must be inserted").toBeTruthy();
    const payload = (auditInsert!.values as { payload: Record<string, unknown> }).payload;
    expect(payload.resourceType).toBe("analytics_forecast_run");
    expect(payload.action).toBe("create");
    expect((auditInsert!.values as { tenantId: string }).tenantId).toBe("t-1");
    expect((auditInsert!.values as { actorId: string }).actorId).toBe("u-1");
  });
});
