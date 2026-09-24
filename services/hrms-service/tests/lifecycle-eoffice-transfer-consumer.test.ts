/**
 * lifecycle eoffice-consumer (hrms.transfer.file_decided) unit tests --
 * mock-based (no real DB).
 *
 * HIGH regression: an eOffice-approved transfer used to apply only
 * departmentId/designationId to the employee master and publish no event at
 * all -- unlike the direct-transfer path (employee/consumer.ts) after its
 * own fix, this path never carried a pay-structure change through to
 * completion and never signalled downstream that a transfer had happened.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { randomUUID } from "node:crypto";
import { MemoryQueue } from "@civitasone/queue";

const {
  mockTx, dbTransactionFn, enqueuedMessages,
  transitionTransferMock, applyTransferEffectMock,
} = vi.hoisted(() => {
  const _mockTx = {
    insert: vi.fn().mockReturnValue({ values: vi.fn().mockResolvedValue(undefined) }),
    update: vi.fn().mockReturnValue({ set: vi.fn().mockReturnValue({ where: vi.fn().mockResolvedValue(undefined) }) }),
    select: vi.fn().mockReturnValue({ from: vi.fn().mockReturnValue({ where: vi.fn().mockReturnValue({ limit: vi.fn().mockResolvedValue([]) }) }) }),
  };
  const _dbTransactionFn = vi.fn(async (cb: (tx: unknown) => Promise<void>) => { await cb(_mockTx); });
  const _enqueuedMessages: Array<{ topic: string; payload: unknown }> = [];
  return {
    mockTx: _mockTx,
    dbTransactionFn: _dbTransactionFn as any,
    enqueuedMessages: _enqueuedMessages,
    transitionTransferMock: vi.fn(),
    // Effective-dating fix (migration 0144, PR #1546): the eOffice-approved
    // path now defers through applyTransferEffect the same way the direct-
    // transfer path does, instead of writing departmentId/payStructureId via
    // employee/repo.ts's updateEmployee directly -- see
    // employee-consumer.test.ts's identical applyTransferEffectMock comment
    // for why this is a spy rather than exercising its real, version-guarded
    // body here.
    applyTransferEffectMock: vi.fn(async () => undefined as any),
  };
});

vi.mock("../src/shared/db.js", () => ({
  scopedRead: dbTransactionFn, db: { transaction: dbTransactionFn },
}));
vi.mock("../src/shared/outbox.js", () => ({
  enqueue: vi.fn(async (_tx: unknown, msg: { topic: string; payload: unknown }) => {
    enqueuedMessages.push({ topic: msg.topic, payload: msg.payload });
  }),
  markProcessed: vi.fn(async () => true),
}));
vi.mock("../src/shared/infra.js", () => ({
  cache: {
    invalidate: vi.fn(async () => undefined),
    makeKey: (...parts: string[]) => parts.join(":"),
  },
}));
vi.mock("../src/modules/lifecycle/repo.js", () => ({
  transitionTransfer: (...a: any[]) => transitionTransferMock(...a),
  // Pure, side-effect-free -- real semantics reproduced inline rather than
  // mocked away, same as employee-consumer.test.ts's identical mock.
  isEffectiveDateDue: (effectiveDate: string, asOf: string) => effectiveDate <= asOf,
  applyTransferEffect: (...a: any[]) => applyTransferEffectMock(...a),
}));

import { registerEOfficeDecisionConsumers } from "../src/modules/lifecycle/eoffice-consumer.js";
import { CONSUMED_EVENTS, EVENTS } from "../src/topics.js";

const TENANT = "10000000-aaaa-4000-8000-000000000001";
const DECIDER = "20000000-bbbb-4000-8000-000000000001";

function makeMsg(payload: Record<string, unknown>) {
  return {
    messageId: randomUUID(), type: CONSUMED_EVENTS.transferFileDecided, tenantId: TENANT, actorId: DECIDER,
    correlationId: randomUUID(), schemaVersion: "1.0", payload,
  };
}

function decisionPayload(overrides: Record<string, unknown> = {}) {
  return {
    fileId: randomUUID(), fileNo: "EOFF-1", refType: "hr_transfer", refId: randomUUID(),
    decision: "approved", notingId: null, dscHash: null,
    decidedBy: DECIDER, decidedAt: new Date().toISOString(),
    ...overrides,
  };
}

async function buildQueue(): Promise<MemoryQueue> {
  const q = new MemoryQueue();
  registerEOfficeDecisionConsumers(q);
  await q.start();
  return q;
}

const settle = () => new Promise<void>((r) => setTimeout(r, 100));

beforeEach(() => {
  vi.clearAllMocks();
  enqueuedMessages.length = 0;
  dbTransactionFn.mockImplementation(async (cb: (tx: unknown) => Promise<void>) => { await cb(mockTx); });
});

describe("hrms.transfer.file_decided (approved)", () => {
  it("applies departmentId/designationId and does NOT touch payStructureId when the pending transfer didn't request one", async () => {
    const employeeId = randomUUID();
    const toDeptId = randomUUID();
    transitionTransferMock.mockResolvedValue({
      id: randomUUID(), employeeId, toDeptId, toDesigId: null,
      fromDeptId: randomUUID(), fromDesigId: null, effectiveDate: "2026-06-01",
      payStructureId: null,
    });
    const q = await buildQueue();
    await q.publish(CONSUMED_EVENTS.transferFileDecided, makeMsg(decisionPayload()));
    await settle();

    expect(applyTransferEffectMock).toHaveBeenCalledOnce();
    const [, transferArg, actorArg] = applyTransferEffectMock.mock.calls[0]! as
      [unknown, Record<string, unknown>, string];
    expect(transferArg.employeeId).toBe(employeeId);
    expect(transferArg.toDeptId).toBe(toDeptId);
    expect(transferArg.payStructureId).toBeNull();
    expect(actorArg).toBe(DECIDER);
    await q.stop();
  });

  // HIGH regression, core of the fix.
  it("applies payStructureId when the pending transfer requested a pay-structure change", async () => {
    const employeeId = randomUUID();
    const toDeptId = randomUUID();
    const payStructureId = randomUUID();
    transitionTransferMock.mockResolvedValue({
      id: randomUUID(), employeeId, toDeptId, toDesigId: null,
      fromDeptId: randomUUID(), fromDesigId: null, effectiveDate: "2026-06-01",
      payStructureId,
    });
    const q = await buildQueue();
    await q.publish(CONSUMED_EVENTS.transferFileDecided, makeMsg(decisionPayload()));
    await settle();

    const [, transferArg] = applyTransferEffectMock.mock.calls[0]! as [unknown, Record<string, unknown>];
    expect(transferArg.payStructureId).toBe(payStructureId);
    await q.stop();
  });

  it("publishes an employeeTransferred event on approval", async () => {
    const employeeId = randomUUID();
    const toDeptId = randomUUID();
    transitionTransferMock.mockResolvedValue({
      id: randomUUID(), employeeId, toDeptId, toDesigId: null,
      fromDeptId: randomUUID(), fromDesigId: null, effectiveDate: "2026-06-01",
      payStructureId: null,
    });
    const q = await buildQueue();
    await q.publish(CONSUMED_EVENTS.transferFileDecided, makeMsg(decisionPayload()));
    await settle();

    const evt = enqueuedMessages.find((m) => m.topic === EVENTS.employeeTransferred);
    expect(evt).toBeDefined();
    expect((evt!.payload as any).employeeId).toBe(employeeId);
    expect((evt!.payload as any).toDeptId).toBe(toDeptId);
    await q.stop();
  });

  it("does not publish an event or touch the employee when the transfer is not ours / already decided (guard rejects)", async () => {
    transitionTransferMock.mockResolvedValue(null);
    const q = await buildQueue();
    await q.publish(CONSUMED_EVENTS.transferFileDecided, makeMsg(decisionPayload()));
    await settle();

    expect(applyTransferEffectMock).not.toHaveBeenCalled();
    expect(enqueuedMessages.find((m) => m.topic === EVENTS.employeeTransferred)).toBeUndefined();
    await q.stop();
  });

  it("does not publish employeeTransferred on rejection", async () => {
    const employeeId = randomUUID();
    transitionTransferMock.mockResolvedValue({
      id: randomUUID(), employeeId, toDeptId: randomUUID(), toDesigId: null,
      fromDeptId: randomUUID(), fromDesigId: null, effectiveDate: "2026-06-01",
      payStructureId: null,
    });
    const q = await buildQueue();
    await q.publish(CONSUMED_EVENTS.transferFileDecided, makeMsg(decisionPayload({ decision: "rejected" })));
    await settle();

    expect(applyTransferEffectMock).not.toHaveBeenCalled();
    expect(enqueuedMessages.find((m) => m.topic === EVENTS.employeeTransferred)).toBeUndefined();
    await q.stop();
  });
});
