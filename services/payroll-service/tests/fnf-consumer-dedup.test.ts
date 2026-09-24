/**
 * HIGH regression (defense in depth): payroll.fnf_settlements now carries a
 * unique (tenant_id, employee_id, separation_date) index (migrations/
 * 0044_fnf_settlements_unique.sql, widened by
 * 0045_fnf_settlements_unique_with_date.sql) so at most one settlement can
 * ever exist per employee PER SEPARATION DATE -- reachable both via a
 * duplicated hrms.employee.separated event (closed at the source by
 * hrms-service's separateEmployee messageId fix) and via POST
 * /v1/payroll/fnf/compute being called twice directly, which that
 * source-side fix cannot reach.
 *
 * IMPORTANT: this is NOT "at most one settlement per employee, full stop" --
 * an employee CAN be legitimately separated more than once (separate ->
 * reinstate -> separate again), each with its own separation_date, and each
 * must get its own settlement row. That is exactly why separation_date is
 * part of the unique key rather than just (tenant_id, employee_id): an
 * earlier version of this fix keyed the index on (tenant_id, employee_id)
 * alone, which silently dropped the second, legitimate settlement outright
 * (live-reproduced against real Postgres -- see
 * fnf-settlements-unique-real-db.test.ts for the real-DB proof of both the
 * "two legitimate settlements" and "true duplicate" cases; this file only
 * covers the consumer's own mechanical handling of onConflictDoNothing,
 * below).
 *
 * This file covers the consumer's own handling of that constraint:
 * onConflictDoNothing must make a duplicate payroll.fnf.compute command (same
 * employee, same separation_date) a safe no-op (skip the event/audit)
 * instead of letting an unhandled 23505 roll back markProcessed and retry
 * forever. It does NOT exercise the real unique index (the mock's
 * `insertReturningMock` just simulates "conflict occurred" vs "no conflict"
 * regardless of which columns are in the target) -- that real-DB proof lives
 * in fnf-settlements-unique-real-db.test.ts, mirroring
 * integration-separation-gratuity.test.ts's mock-based harness here for the
 * consumer-logic layer.
 *
 * Mock-based (no real DB), mirroring integration-separation-gratuity.test.ts's
 * harness. computeFnfSettlement (domain.ts) runs for real -- it's a pure
 * function -- with a minimal valid input.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { randomUUID } from "node:crypto";
import { MemoryQueue } from "@civitasone/queue";

const {
  mockTx, dbTransactionFn, enqueuedMessages, insertReturningMock, markProcessedMock,
} = vi.hoisted(() => {
  const _insertReturningMock = vi.fn();
  const _mockTx = {
    insert: vi.fn().mockReturnValue({
      values: vi.fn().mockReturnValue({
        onConflictDoNothing: vi.fn().mockReturnValue({
          returning: _insertReturningMock,
        }),
      }),
    }),
    select: vi.fn().mockReturnValue({
      from: vi.fn().mockReturnValue({
        where: vi.fn().mockResolvedValue([]),
      }),
    }),
  };
  const _dbTransactionFn = vi.fn(async (cb: (tx: unknown) => Promise<void>) => { await cb(_mockTx); });
  const _enqueuedMessages: Array<{ topic: string; payload: unknown }> = [];
  return {
    mockTx: _mockTx,
    dbTransactionFn: _dbTransactionFn as any,
    enqueuedMessages: _enqueuedMessages,
    insertReturningMock: _insertReturningMock,
    markProcessedMock: vi.fn(async () => true),
  };
});

vi.mock("../src/shared/db.js", () => ({
  scopedRead: dbTransactionFn, db: { transaction: dbTransactionFn },
}));
vi.mock("../src/shared/outbox.js", () => ({
  enqueue: vi.fn(async (_tx: unknown, msg: { topic: string; payload: unknown }) => {
    enqueuedMessages.push({ topic: msg.topic, payload: msg.payload });
  }),
  markProcessed: (...a: any[]) => markProcessedMock(...a),
}));

import { registerFnfConsumers } from "../src/modules/fnf/consumer.js";
import { COMMANDS, EVENTS } from "../src/topics.js";

const TENANT = "10000000-aaaa-4000-8000-000000000001";
const ACTOR = "20000000-bbbb-4000-8000-000000000001";

function makeMsg(payload: Record<string, unknown>) {
  return {
    messageId: randomUUID(), type: COMMANDS.fnfCompute, tenantId: TENANT, actorId: ACTOR,
    correlationId: randomUUID(), schemaVersion: "1.0", payload,
  };
}

function computePayload(overrides: Record<string, unknown> = {}) {
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
    ...overrides,
  };
}

async function buildQueue(): Promise<MemoryQueue> {
  const q = new MemoryQueue();
  registerFnfConsumers(q);
  await q.start();
  return q;
}

const settle = () => new Promise<void>((r) => setTimeout(r, 100));

beforeEach(() => {
  vi.clearAllMocks();
  enqueuedMessages.length = 0;
  markProcessedMock.mockResolvedValue(true);
  dbTransactionFn.mockImplementation(async (cb: (tx: unknown) => Promise<void>) => { await cb(mockTx); });
});

describe("payroll.fnf.compute -- unique-constraint dedup", () => {
  it("inserts and publishes fnfComputed + audit when no conflict occurs", async () => {
    insertReturningMock.mockResolvedValue([{ id: randomUUID() }]);
    const q = await buildQueue();
    await q.publish(COMMANDS.fnfCompute, makeMsg(computePayload()));
    await settle();

    expect(enqueuedMessages.find((m) => m.topic === EVENTS.fnfComputed)).toBeDefined();
    expect(enqueuedMessages.find((m) => m.topic === "audit.event.record")).toBeDefined();
    await q.stop();
  });

  it("skips fnfComputed + audit when the unique (tenant_id, employee_id, separation_date) index rejects a duplicate insert", async () => {
    // onConflictDoNothing().returning() resolves empty when the insert hit
    // the conflict target instead of writing a row.
    insertReturningMock.mockResolvedValue([]);
    const q = await buildQueue();
    await q.publish(COMMANDS.fnfCompute, makeMsg(computePayload()));
    await settle();

    expect(enqueuedMessages.find((m) => m.topic === EVENTS.fnfComputed)).toBeUndefined();
    expect(enqueuedMessages.find((m) => m.topic === "audit.event.record")).toBeUndefined();
    await q.stop();
  });

  it("does not throw (no DLQ / poison-message retry loop) when the conflict occurs", async () => {
    insertReturningMock.mockResolvedValue([]);
    const q = await buildQueue();
    await q.publish(COMMANDS.fnfCompute, makeMsg(computePayload()));
    await settle();

    expect(q.dlq).toHaveLength(0);
    await q.stop();
  });
});
