/**
 * F3 deputation consumer — unit tests.
 *
 * Same bug class as the leave fix documented in ../leave/f3-consumer.test.ts:
 * `deputation_routes__0` (depute OUT) referenced `depId` and `emp`, which the
 * code-gen never defined, so it threw a ReferenceError on every invocation
 * while POST /v1/hrms/employees/:id/deputations had already answered 201 with
 * the deputation body. No deputation row, no posting/reporting switch and no
 * service-book entry were ever written.
 *
 * `deputation_routes__1` (repatriate/cancel) is STILL broken by design — see
 * the KNOWN GAP test at the bottom and the TODO(unresolved-f3-bug) in
 * f3-consumer.ts.
 *
 * Driven directly over a MemoryQueue (as ../leave/f3-consumer.test.ts does)
 * because the F3 consumers are registered only in worker.ts, never in app.ts.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { randomUUID } from "node:crypto";
import { MemoryQueue } from "@civitasone/queue";

const {
  mockTx, dbTransactionFn, scopedReadResult,
  insertDeputationMock, closeDeputationMock, updateSetMock, insertValuesMock,
} = vi.hoisted(() => {
  const _insertDeputationMock = vi.fn(async (..._a: any[]) => undefined);
  const _closeDeputationMock = vi.fn(async (..._a: any[]) => undefined);
  const _updateSetMock = vi.fn().mockReturnValue({ where: vi.fn(async (..._a: any[]) => undefined) });
  const _insertValuesMock = vi.fn(async (..._a: any[]) => undefined);
  const _scopedReadResult: { current: any[] } = { current: [] };
  const _mockTx = {
    update: vi.fn().mockReturnValue({ set: _updateSetMock }),
    insert: vi.fn().mockReturnValue({ values: (v: unknown) => _insertValuesMock(v) }),
    select: vi.fn(),
  };
  const _dbTransactionFn = vi.fn(async (cb: (tx: unknown) => Promise<void>) => { await cb(_mockTx); });
  return {
    mockTx: _mockTx, dbTransactionFn: _dbTransactionFn, scopedReadResult: _scopedReadResult,
    insertDeputationMock: _insertDeputationMock, closeDeputationMock: _closeDeputationMock,
    updateSetMock: _updateSetMock, insertValuesMock: _insertValuesMock,
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
vi.mock("./repo.js", () => ({
  insertDeputation: (...a: unknown[]) => insertDeputationMock(...(a as [])),
  closeDeputation: (...a: unknown[]) => closeDeputationMock(...(a as [])),
  findById: vi.fn(async (..._a: any[]) => null),
  findActiveByEmployee: vi.fn(async (..._a: any[]) => null),
  listByEmployee: vi.fn(async (..._a: any[]) => []),
}));

import { registerF3_deputation_Consumers } from "./f3-consumer.js";
import { COMMANDS } from "../../topics.js";

const TENANT = "10000000-aaaa-4000-8000-000000000001";
const ACTOR = "20000000-bbbb-4000-8000-000000000001";
const EMPLOYEE = "30000000-cccc-4000-8000-000000000001";
const PARENT_DEPT = "40000000-dddd-4000-8000-000000000001";
const PARENT_MGR = "50000000-eeee-4000-8000-000000000001";
const BORROW_DEPT = "40000000-dddd-4000-8000-000000000002";
const BORROW_MGR = "50000000-eeee-4000-8000-000000000002";

const employee = (over: Record<string, unknown> = {}) => ({
  id: EMPLOYEE, tenantId: TENANT, employeeNo: "E-001", fullName: "Test Emp",
  departmentId: PARENT_DEPT, managerId: PARENT_MGR, status: "confirmed",
  ...over,
});

const body = {
  parentCadre: "Section Officer",
  borrowingDepartment: "Finance Ministry",
  borrowingDepartmentId: BORROW_DEPT,
  borrowingManagerId: BORROW_MGR,
  deputationAllowanceMinor: 500000,
  tenureFrom: "2025-01-01",
  tenureTo: "2027-12-31",
  orderRef: "ORD/2025/17",
};

function makeMsg(payload: Record<string, unknown>) {
  return {
    messageId: randomUUID(), type: COMMANDS.f3RouteWrite, tenantId: TENANT,
    actorId: ACTOR, correlationId: `corr-${randomUUID()}`, schemaVersion: "1.0", payload,
  };
}

async function buildQueue(): Promise<MemoryQueue> {
  const q = new MemoryQueue({ maxAttempts: 1 });
  registerF3_deputation_Consumers(q);
  await q.start();
  return q;
}

beforeEach(() => {
  vi.clearAllMocks();
  scopedReadResult.current = [employee()];
  updateSetMock.mockReturnValue({ where: vi.fn(async (..._a: any[]) => undefined) });
  dbTransactionFn.mockImplementation(async (cb: (tx: unknown) => Promise<void>) => { await cb(mockTx); });
});

describe("deputation_routes__0 (depute OUT)", () => {
  it("writes the deputation instead of throwing ReferenceError: emp is not defined", async () => {
    const q = await buildQueue();
    const depId = randomUUID();
    await q.publish(COMMANDS.f3RouteWrite, makeMsg({
      op: "deputation_routes__0", id: depId, tenantId: TENANT,
      body, params: { id: EMPLOYEE }, query: {},
    }));
    await q.drain();

    expect(q.dlq).toHaveLength(0);
    expect(insertDeputationMock).toHaveBeenCalledOnce();
    const row = insertDeputationMock.mock.calls[0]![1] as Record<string, any>;
    expect(row.id).toBe(depId);
    expect(row.tenantId).toBe(TENANT);
    // Regression guard for the second defect: the employee must come from the
    // URL path param, NOT from the publish-time uuid in `p.id`.
    expect(row.employeeId).toBe(EMPLOYEE);
    expect(row.status).toBe("active");
    expect(row.parentCadre).toBe("Section Officer");
    // The parent posting snapshot is the whole reason `emp` had to be fetched:
    // repatriation later restores these two columns.
    expect(row.parentDepartmentId).toBe(PARENT_DEPT);
    expect(row.parentManagerId).toBe(PARENT_MGR);
    expect(row.borrowingDepartmentId).toBe(BORROW_DEPT);
    expect(row.deputationAllowanceMinor).toBe(500000n);
    expect(row.orderRef).toBe("ORD/2025/17");
    await q.stop();
  });

  it("switches the employee's effective posting and writes a service-book entry", async () => {
    const q = await buildQueue();
    await q.publish(COMMANDS.f3RouteWrite, makeMsg({
      op: "deputation_routes__0", id: randomUUID(), tenantId: TENANT,
      body, params: { id: EMPLOYEE }, query: {},
    }));
    await q.drain();

    expect(updateSetMock).toHaveBeenCalledOnce();
    const patch = updateSetMock.mock.calls[0]![0] as Record<string, unknown>;
    expect(patch.departmentId).toBe(BORROW_DEPT);
    expect(patch.managerId).toBe(BORROW_MGR);

    expect(insertValuesMock).toHaveBeenCalledOnce();
    const sb = insertValuesMock.mock.calls[0]![0] as Record<string, any>;
    expect(sb.employeeId).toBe(EMPLOYEE);
    expect(sb.entryType).toBe("deputation_out");
    expect(sb.effectiveDate).toBe("2025-01-01");
    expect(sb.description).toContain("Finance Ministry");
    expect(sb.description).toContain("deputation allowance");
    expect(sb.documentRef).toBe("ORD/2025/17");
    await q.stop();
  });

  it("omits the parent manager snapshot when the employee has no manager", async () => {
    scopedReadResult.current = [employee({ managerId: null })];
    const q = await buildQueue();
    await q.publish(COMMANDS.f3RouteWrite, makeMsg({
      op: "deputation_routes__0", id: randomUUID(), tenantId: TENANT,
      body, params: { id: EMPLOYEE }, query: {},
    }));
    await q.drain();
    const row = insertDeputationMock.mock.calls[0]![1] as Record<string, any>;
    expect(row.parentDepartmentId).toBe(PARENT_DEPT);
    expect("parentManagerId" in row).toBe(false);
    await q.stop();
  });

  it("skips the write when the employee no longer exists", async () => {
    scopedReadResult.current = [];
    const q = await buildQueue();
    await q.publish(COMMANDS.f3RouteWrite, makeMsg({
      op: "deputation_routes__0", id: randomUUID(), tenantId: TENANT,
      body, params: { id: EMPLOYEE }, query: {},
    }));
    await q.drain();
    expect(q.dlq).toHaveLength(0);
    expect(insertDeputationMock).not.toHaveBeenCalled();
    await q.stop();
  });

  it("ignores ops that don't belong to this consumer", async () => {
    const q = await buildQueue();
    await q.publish(COMMANDS.f3RouteWrite, makeMsg({
      op: "some_other_module_routes__0", id: randomUUID(), tenantId: TENANT, body: {}, params: {}, query: {},
    }));
    await q.drain();
    expect(insertDeputationMock).not.toHaveBeenCalled();
    await q.stop();
  });
});

describe("deputation_routes__1 (repatriate / cancel)", () => {
  it("KNOWN GAP: still dead-letters — repatriate and cancel are indistinguishable in the queue", async () => {
    // Both POST .../repatriate and POST .../cancel go through the same shared
    // close() helper in routes.ts and publish the SAME op string with the same
    // { body, params, query }, so `newStatus` ("repatriated" vs "cancelled")
    // cannot be recovered here. Writing the wrong terminal status onto a real
    // service record is worse than failing, so this case is deliberately left
    // unfixed until the route forwards it. See TODO(unresolved-f3-bug) in
    // f3-consumer.ts.
    //
    // WHEN THE ROUTE IS FIXED: delete this test and replace it with real
    // repatriate/cancel coverage.
    const q = await buildQueue();
    await q.publish(COMMANDS.f3RouteWrite, makeMsg({
      op: "deputation_routes__1", id: randomUUID(), tenantId: TENANT,
      body: { repatriatedOn: "2026-06-01" }, params: { depId: randomUUID() }, query: {},
    }));
    await q.drain();

    expect(closeDeputationMock).not.toHaveBeenCalled();
    expect(q.dlq).toHaveLength(1);
    expect(q.dlq[0]!.error).toMatch(/is not defined/);
    await q.stop();
  });
});
