/**
 * HIGH regression: payroll-service creates/approves a salary revision in one
 * step and already published payroll.salary_revision.created, but nothing
 * in hrms-service consumed it -- hrmsEmployees.basicMinor went stale the
 * moment a revision landed in payroll's own database, and hrms-service's
 * own separation/gratuity computation (employee/consumer.ts's
 * employeeSeparate handler) reads emp.basicMinor directly, so a stale
 * figure could be used at exit.
 *
 * Mock-based (no real DB), mirroring employee-consumer.test.ts's harness.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { randomUUID } from "node:crypto";
import { MemoryQueue } from "@civitasone/queue";

const {
  mockTx, dbTransactionFn, enqueuedMessages,
  findVersionForUpdateMock, updateEmployeeVersionedMock,
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
    findVersionForUpdateMock: vi.fn(async () => ({ version: 1, basicMinor: 4000000n }) as any),
    updateEmployeeVersionedMock: vi.fn(async () => undefined as any),
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
vi.mock("../src/modules/employee/repo.js", () => ({
  findVersionForUpdate: (...a: any[]) => findVersionForUpdateMock(...a),
  updateEmployeeVersioned: (...a: any[]) => updateEmployeeVersionedMock(...a),
}));

import { registerIntegrationConsumers } from "../src/modules/integration/consumer.js";
import { CONSUMED_EVENTS } from "../src/topics.js";

const TENANT = "10000000-aaaa-4000-8000-000000000001";
const ACTOR = "20000000-bbbb-4000-8000-000000000001";

function makeMsg(payload: Record<string, unknown>) {
  return {
    messageId: randomUUID(), type: CONSUMED_EVENTS.salaryRevisionCreated, tenantId: TENANT, actorId: ACTOR,
    correlationId: randomUUID(), schemaVersion: "1.0", payload,
  };
}

async function buildQueue(): Promise<MemoryQueue> {
  const q = new MemoryQueue();
  registerIntegrationConsumers(q);
  await q.start();
  return q;
}

const settle = () => new Promise<void>((r) => setTimeout(r, 100));

beforeEach(() => {
  vi.clearAllMocks();
  enqueuedMessages.length = 0;
  dbTransactionFn.mockImplementation(async (cb: (tx: unknown) => Promise<void>) => { await cb(mockTx); });
  findVersionForUpdateMock.mockResolvedValue({ version: 1, basicMinor: 4000000n });
});

describe("payroll.salary_revision.created -> hrms basicMinor sync", () => {
  it("writes the new basicMinor through the optimistic-concurrency guard", async () => {
    const employeeId = randomUUID();
    const revisionId = randomUUID();
    const q = await buildQueue();
    await q.publish(CONSUMED_EVENTS.salaryRevisionCreated, makeMsg({
      id: revisionId, employeeId, newBasicMinor: 4400000,
    }));
    await settle();

    expect(findVersionForUpdateMock).toHaveBeenCalledOnce();
    expect(findVersionForUpdateMock).toHaveBeenCalledWith(expect.anything(), employeeId, TENANT);
    expect(updateEmployeeVersionedMock).toHaveBeenCalledOnce();
    const [, id, tenantId, expectedVersion, patch] = updateEmployeeVersionedMock.mock.calls[0]! as
      [unknown, string, string, number, Record<string, unknown>, string];
    expect(id).toBe(employeeId);
    expect(tenantId).toBe(TENANT);
    expect(expectedVersion).toBe(1);
    expect(patch.basicMinor).toBe(4400000n);
    await q.stop();
  });

  it("skips the write (no throw) when the employee doesn't exist in HRMS under this tenant", async () => {
    findVersionForUpdateMock.mockResolvedValue(null);
    const q = await buildQueue();
    await q.publish(CONSUMED_EVENTS.salaryRevisionCreated, makeMsg({
      id: randomUUID(), employeeId: randomUUID(), newBasicMinor: 4400000,
    }));
    await settle();

    expect(updateEmployeeVersionedMock).not.toHaveBeenCalled();
    await q.stop();
  });

  it("publishes an audit event referencing the source salary revision", async () => {
    const employeeId = randomUUID();
    const revisionId = randomUUID();
    const q = await buildQueue();
    await q.publish(CONSUMED_EVENTS.salaryRevisionCreated, makeMsg({
      id: revisionId, employeeId, newBasicMinor: 4400000,
    }));
    await settle();

    const audit = enqueuedMessages.find((m) => m.topic === "audit.event.record");
    expect(audit).toBeDefined();
    const payload = audit!.payload as Record<string, unknown>;
    expect(payload.resourceId).toBe(employeeId);
    expect((payload.metadata as Record<string, unknown>).salaryRevisionId).toBe(revisionId);
    await q.stop();
  });
});
