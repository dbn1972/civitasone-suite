/**
 * F3 pension consumer — unit tests.
 *
 * Same bug class as the leave fix documented in ../leave/f3-consumer.test.ts:
 * `pension_routes__0` kept the repo.insertPensionRecord(...) call but the
 * code-gen dropped the "fetch employee + service book, then compute the
 * pension" preamble, so `result`, `q`, `emp`, `recordId` and `jsonSafe` were
 * referenced but never defined. The case threw a ReferenceError on every
 * invocation while GET /v1/hrms/employees/:id/pension?persist=true had already
 * answered 200 with the full breakup and a `persistedRecordId` — a fake
 * success: nothing was ever written to pension.hrms_pension_records.
 *
 * These tests drive the consumer directly over a MemoryQueue (the same pattern
 * as ../leave/f3-consumer.test.ts) because the F3 consumers are registered only
 * in worker.ts, never in app.ts — route-level tests cannot reach them.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { randomUUID } from "node:crypto";
import { MemoryQueue } from "@civitasone/queue";

const { mockTx, dbTransactionFn, scopedReadResult, insertPensionRecordMock, serviceBookRows } = vi.hoisted(() => {
  const _insertPensionRecordMock = vi.fn(async (..._a: any[]) => undefined);
  const _scopedReadResult: { current: any[] } = { current: [] };
  const _serviceBookRows: { current: any[] } = { current: [] };
  const _mockTx = { insert: vi.fn(), update: vi.fn(), select: vi.fn() };
  const _dbTransactionFn = vi.fn(async (cb: (tx: unknown) => Promise<void>) => { await cb(_mockTx); });
  return {
    mockTx: _mockTx,
    dbTransactionFn: _dbTransactionFn,
    scopedReadResult: _scopedReadResult,
    insertPensionRecordMock: _insertPensionRecordMock,
    serviceBookRows: _serviceBookRows,
  };
});

vi.mock("../../shared/db.js", () => ({
  db: { transaction: dbTransactionFn },
  scopedRead: async () => scopedReadResult.current,
}));
vi.mock("../../shared/outbox.js", () => ({
  enqueue: vi.fn(async (..._a: any[]) => undefined),
  markProcessed: vi.fn(async (..._a: any[]) => true),
}));
vi.mock("../service-book/repo.js", () => ({
  listServiceBookEntries: async () => serviceBookRows.current,
}));
vi.mock("./repo.js", () => ({
  insertPensionRecord: (...a: unknown[]) => insertPensionRecordMock(...(a as [])),
  listByEmployee: vi.fn(async (..._a: any[]) => []),
}));

import { registerF3_pension_Consumers } from "./f3-consumer.js";
import { COMMANDS } from "../../topics.js";

const TENANT = "10000000-aaaa-4000-8000-000000000001";
const ACTOR = "20000000-bbbb-4000-8000-000000000001";
const EMPLOYEE = "30000000-cccc-4000-8000-000000000001";

const employee = (over: Record<string, unknown> = {}) => ({
  id: EMPLOYEE, tenantId: TENANT, employeeNo: "E-001", fullName: "Test Emp",
  pensionScheme: "GPF", dateOfJoining: "1990-06-01", dateOfBirth: "1966-05-20",
  basicMinor: 5600000n, currency: "INR",
  ...over,
});

function makeMsg(payload: Record<string, unknown>) {
  return {
    messageId: randomUUID(), type: COMMANDS.f3RouteWrite, tenantId: TENANT,
    actorId: ACTOR, correlationId: `corr-${randomUUID()}`, schemaVersion: "1.0", payload,
  };
}

async function buildQueue(): Promise<MemoryQueue> {
  const q = new MemoryQueue();
  registerF3_pension_Consumers(q);
  await q.start();
  return q;
}

beforeEach(() => {
  vi.clearAllMocks();
  scopedReadResult.current = [employee()];
  serviceBookRows.current = [];
  dbTransactionFn.mockImplementation(async (cb: (tx: unknown) => Promise<void>) => { await cb(mockTx); });
});

describe("pension_routes__0 (persist a computed pension record)", () => {
  it("writes the pension record instead of throwing ReferenceError: result is not defined", async () => {
    const q = await buildQueue();
    const recordId = randomUUID();
    await q.publish(COMMANDS.f3RouteWrite, makeMsg({
      op: "pension_routes__0", id: recordId, tenantId: TENANT,
      body: {}, params: { id: EMPLOYEE },
      query: { retirementDate: "2026-05-31", daRatePct: "50", commutePct: "40", elBalanceDays: "300", persist: "true" },
    }));
    await q.drain();

    // The whole point of the bug: before the fix this dead-lettered with
    // "result is not defined" and insertPensionRecord was never reached.
    expect(q.dlq).toHaveLength(0);
    expect(insertPensionRecordMock).toHaveBeenCalledOnce();

    const row = insertPensionRecordMock.mock.calls[0]![1] as Record<string, any>;
    expect(row.id).toBe(recordId);
    expect(row.tenantId).toBe(TENANT);
    // Regression guard for the second defect: the employee must come from the
    // URL path param, NOT from the publish-time uuid in `p.id`.
    expect(row.employeeId).toBe(EMPLOYEE);
    expect(row.pensionScheme).toBe("GPF");
    expect(row.retirementDate).toBe("2026-05-31");
    expect(row.dateOfJoining).toBe("1990-06-01");
    expect(row.lastBasicMinor).toBe(5600000n);
    expect(row.daRatePct).toBe("50");
    // Real engine output — a ~36-year career earns full (50%) pension.
    expect(typeof row.monthlyPensionMinor).toBe("bigint");
    expect(row.monthlyPensionMinor).toBeGreaterThan(0n);
    expect(row.commutedPct).toBe("40");
    expect(Number(row.qualifyingYears)).toBeGreaterThan(30);
    // breakdown must be JSON-safe (bigints stringified) or the jsonb write blows up
    expect(JSON.stringify(row.breakdown)).toContain("monthlyPensionMinor");
    expect(row.createdBy).toBe(ACTOR);
    await q.stop();
  });

  it("applies the same Zod defaults the route's query schema does when they are omitted", async () => {
    const q = await buildQueue();
    await q.publish(COMMANDS.f3RouteWrite, makeMsg({
      op: "pension_routes__0", id: randomUUID(), tenantId: TENANT,
      body: {}, params: { id: EMPLOYEE }, query: { retirementDate: "2026-05-31", persist: "true" },
    }));
    await q.drain();
    expect(q.dlq).toHaveLength(0);
    const row = insertPensionRecordMock.mock.calls[0]![1] as Record<string, any>;
    expect(row.daRatePct).toBe("50");   // query.daRatePct .default(50)
    expect(row.commutedPct).toBe("40"); // query.commutePct .default(40)
    await q.stop();
  });

  it("nets non-qualifying service out of the qualifying period", async () => {
    const q = await buildQueue();
    const publish = () => q.publish(COMMANDS.f3RouteWrite, makeMsg({
      op: "pension_routes__0", id: randomUUID(), tenantId: TENANT,
      body: {}, params: { id: EMPLOYEE }, query: { retirementDate: "2026-05-31", persist: "true" },
    }));

    await publish();
    await q.drain();
    const clean = insertPensionRecordMock.mock.calls[0]![1] as Record<string, any>;

    insertPensionRecordMock.mockClear();
    serviceBookRows.current = [
      { entryType: "dies_non", effectiveDate: "2010-01-01", description: "dies-non spell; days=400" },
    ];
    await publish();
    await q.drain();
    const docked = insertPensionRecordMock.mock.calls[0]![1] as Record<string, any>;

    // The service book is genuinely consulted — a dies-non spell must not be
    // silently ignored the way it was while this case crashed.
    expect(docked.breakdown.qualifying.nonQualifyingDays).toBeGreaterThan(0);
    expect(docked.breakdown.qualifying.nonQualifyingDays)
      .toBeGreaterThan(clean.breakdown.qualifying.nonQualifyingDays);
    await q.stop();
  });

  it("does not write a defined-benefit record for an NPS employee", async () => {
    scopedReadResult.current = [employee({ pensionScheme: "NPS" })];
    const q = await buildQueue();
    await q.publish(COMMANDS.f3RouteWrite, makeMsg({
      op: "pension_routes__0", id: randomUUID(), tenantId: TENANT,
      body: {}, params: { id: EMPLOYEE }, query: { retirementDate: "2026-05-31", persist: "true" },
    }));
    await q.drain();
    expect(q.dlq).toHaveLength(0);
    expect(insertPensionRecordMock).not.toHaveBeenCalled();
    await q.stop();
  });

  it("ignores ops that don't belong to this consumer", async () => {
    const q = await buildQueue();
    await q.publish(COMMANDS.f3RouteWrite, makeMsg({
      op: "some_other_module_routes__0", id: randomUUID(), tenantId: TENANT, body: {}, params: {}, query: {},
    }));
    await q.drain();
    expect(insertPensionRecordMock).not.toHaveBeenCalled();
    await q.stop();
  });
});
