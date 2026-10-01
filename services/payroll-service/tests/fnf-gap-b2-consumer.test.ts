/**
 * GAP-PAYROLL-FNF-03 (b2-payroll-retirement batch): when the clerk overrides
 * a record-derived F&F input (completed years / leave balance), the reason
 * must be persisted with the settlement (computation_detail) and carried on
 * the audit event -- a hand-typed value that decides a final payout is never
 * silent. Mock-based harness mirroring fnf-consumer-dedup.test.ts.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { randomUUID } from "node:crypto";
import { MemoryQueue } from "@civitasone/queue";

const { mockTx, dbTransactionFn, enqueued, insertedValues } = vi.hoisted(() => {
  const _inserted: Array<Record<string, unknown>> = [];
  const _mockTx = {
    insert: vi.fn().mockReturnValue({
      values: vi.fn((v: Record<string, unknown>) => {
        _inserted.push(v);
        return { onConflictDoNothing: vi.fn().mockReturnValue({ returning: vi.fn().mockResolvedValue([{ id: v.id }]) }) };
      }),
    }),
    select: vi.fn().mockReturnValue({ from: vi.fn().mockReturnValue({ where: vi.fn().mockResolvedValue([]) }) }),
  };
  return {
    mockTx: _mockTx,
    dbTransactionFn: vi.fn(async (cb: (tx: unknown) => Promise<void>) => { await cb(_mockTx); }) as any,
    enqueued: [] as Array<{ topic: string; payload: Record<string, unknown> }>,
    insertedValues: _inserted,
  };
});

vi.mock("../src/shared/db.js", () => ({ scopedRead: dbTransactionFn, db: { transaction: dbTransactionFn } }));
vi.mock("../src/shared/outbox.js", () => ({
  enqueue: vi.fn(async (_tx: unknown, msg: { topic: string; payload: Record<string, unknown> }) => {
    enqueued.push({ topic: msg.topic, payload: msg.payload });
  }),
  markProcessed: vi.fn(async () => true),
}));

import { registerFnfConsumers } from "../src/modules/fnf/consumer.js";
import { COMMANDS } from "../src/topics.js";

const TENANT = "10000000-aaaa-4000-8000-0000000000b2";
const ACTOR = "20000000-bbbb-4000-8000-0000000000b2";

function payload(extra: Record<string, unknown> = {}) {
  return {
    employeeId: randomUUID(), tenantId: TENANT,
    separationDate: "2026-06-30", separationType: "retirement", employeeCategory: "non_govt_covered",
    noticeBuyoutMinor: "0", leaveEncashmentGrossMinor: "0", gratuityGrossMinor: "1000000",
    retrenchmentCompMinor: "0", vrsCompMinor: "0", arrearsMinor: "0",
    lastDrawnWagesMinor: "5000000", completedYears: 10, avgSalaryLast10MonthsMinor: "5000000",
    leaveBalanceDays: 0, priorLeaveEncashExemptionMinor: "0", remainingMonthsToRetirement: 0,
    taxRegime: "new", salaryYtdMinor: "0", tdsYtdMinor: "0",
    deductions80cMinor: "0", deductions80dMinor: "0", otherDeductionsMinor: "0",
    fyStartYear: 2026,
    ...extra,
  };
}

async function run(p: Record<string, unknown>) {
  const q = new MemoryQueue();
  registerFnfConsumers(q);
  await q.start();
  await q.publish(COMMANDS.fnfCompute, {
    messageId: randomUUID(), type: COMMANDS.fnfCompute, tenantId: TENANT, actorId: ACTOR,
    correlationId: randomUUID(), schemaVersion: "1.0", payload: p,
  });
  await new Promise<void>((r) => setTimeout(r, 100));
  await q.stop();
}

beforeEach(() => {
  insertedValues.length = 0;
  enqueued.length = 0;
  void mockTx;
});

describe("fnfCompute consumer — override reason is persisted and audited", () => {
  it("stores overrides in computation_detail and on the audit event", async () => {
    const overrides = { fields: ["completedYears"], reason: "Service book shows 2 extra years of deputation" };
    await run(payload({ overrides }));
    expect(insertedValues).toHaveLength(1);
    expect((insertedValues[0]!.computationDetail as Record<string, unknown>).overrides).toEqual(overrides);
    const audit = enqueued.find((e) => e.topic === "audit.event.record");
    expect(audit?.payload.metadata).toEqual({ overriddenFields: ["completedYears"], overrideReason: overrides.reason });
  });

  it("adds nothing when there was no override", async () => {
    await run(payload());
    expect(insertedValues[0]!.computationDetail).not.toHaveProperty("overrides");
    const audit = enqueued.find((e) => e.topic === "audit.event.record");
    expect(audit?.payload).not.toHaveProperty("metadata");
  });
});
