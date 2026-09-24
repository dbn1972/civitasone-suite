/**
 * Employee consumer unit tests — mock-based (no real DB).
 * Covers: employeeCreate, employeeConfirm, employeeTransfer,
 *         employeeSeparate, employeeUpdate commands.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { randomUUID } from "node:crypto";
import { MemoryQueue } from "@civitasone/queue";

// ─── Hoisted mocks ─────────────────────────────────────────────────────────
const {
  mockTx, dbTransactionFn, enqueuedMessages,
  insertEmployeeMock, updateEmployeeMock, findByIdMock,
  insertTransferMock, insertSeparationMock, insertPromotionMock,
  findVersionForUpdateMock, updateEmployeeVersionedMock, applyTransferEffectMock,
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
    insertEmployeeMock: vi.fn(async () => undefined as any),
    updateEmployeeMock: vi.fn(async () => undefined as any),
    findByIdMock: vi.fn(async () => null as any),
    insertTransferMock: vi.fn(async () => undefined as any),
    insertSeparationMock: vi.fn(async () => undefined as any),
    insertPromotionMock: vi.fn(async () => undefined as any),
    // basicMinor optimistic-concurrency guard (employee/repo.ts): every
    // employeeUpdate that touches basicMinor now reads {version, basicMinor}
    // fresh via findVersionForUpdate, then writes via updateEmployeeVersioned
    // instead of the blind-overwrite updateEmployee — see the "updates
    // employee fields" test below.
    findVersionForUpdateMock: vi.fn(async () => ({ version: 1, basicMinor: 5000000n })),
    updateEmployeeVersionedMock: vi.fn(async () => undefined as any),
    // Bug 2 fix (lifecycle/repo.ts's applyTransferEffect version-guard):
    // mocked as a plain spy here, not exercised for real — this file tests
    // employee/consumer.ts's OWN control flow (does it call
    // applyTransferEffect, with what arguments, when?) in isolation from
    // lifecycle/repo.js, which is fully mocked below. applyTransferEffect's
    // OWN internal optimistic-concurrency behaviour is exercised for real,
    // against a real DB, by lifecycle/effective-dating.test.ts's "Bug 2"
    // describe block instead.
    applyTransferEffectMock: vi.fn(async () => undefined as any),
  };
});

vi.mock("../src/shared/db.js", () => ({
  scopedRead: dbTransactionFn, db: { transaction: dbTransactionFn } }));
vi.mock("../src/shared/outbox.js", () => ({
  enqueue: vi.fn(async (_tx: unknown, msg: { topic: string; payload: unknown }) => {
    enqueuedMessages.push({ topic: msg.topic, payload: msg.payload });
  }),
  markProcessed: vi.fn(async () => true),
}));
vi.mock("../src/shared/infra.js", () => ({
  cache: {
    invalidate: vi.fn(async () => undefined),
    invalidateResource: vi.fn(async () => undefined),
    makeKey: (...parts: string[]) => parts.join(":"),
  },
}));
vi.mock("../src/modules/employee/repo.js", () => ({
  insertEmployee: (...a: any[]) => insertEmployeeMock(...a),
  updateEmployee: (...a: any[]) => updateEmployeeMock(...a),
  findById: (...a: any[]) => findByIdMock(...a),
  // Tx-scoped variant (fix/hrms-batch2-nested-tx-deadlock): employeeSeparate
  // now reads through its own already-open transaction instead of the
  // scopedRead-based findById above. Forwarded to the SAME mock.
  findByIdTx: (...a: any[]) => findByIdMock(...a),
  findVersionForUpdate: (...a: any[]) => findVersionForUpdateMock(...a),
  updateEmployeeVersioned: (...a: any[]) => updateEmployeeVersionedMock(...a),
}));
vi.mock("../src/modules/lifecycle/repo.js", () => ({
  insertTransfer: (...a: any[]) => insertTransferMock(...a),
  insertSeparation: (...a: any[]) => insertSeparationMock(...a),
  insertPromotion: (...a: any[]) => insertPromotionMock(...a),
  // employee/consumer.ts's employeeTransfer handler (migration 0144's
  // effective-dating fix) also calls isEffectiveDateDue — a pure,
  // side-effect-free function, so the real semantics are reproduced inline
  // rather than mocked away — and applyTransferEffect, mocked as a spy (see
  // applyTransferEffectMock's hoisted comment above for why).
  isEffectiveDateDue: (effectiveDate: string, asOf: string) => effectiveDate <= asOf,
  applyTransferEffect: (...a: any[]) => applyTransferEffectMock(...a),
}));

// Now import the consumer AFTER mocks
import { registerEmployeeConsumers } from "../src/modules/employee/consumer.js";
import { COMMANDS, EVENTS } from "../src/topics.js";

// ─── Helpers ────────────────────────────────────────────────────────────────
const TENANT = "10000000-aaaa-4000-8000-000000000001";
const ACTOR = "20000000-bbbb-4000-8000-000000000001";

function makeMsg(type: string, payload: Record<string, unknown>) {
  return {
    messageId: randomUUID(),
    type, tenantId: TENANT, actorId: ACTOR,
    correlationId: randomUUID(), schemaVersion: "1.0", payload,
  };
}

async function buildQueue(): Promise<MemoryQueue> {
  const q = new MemoryQueue();
  registerEmployeeConsumers(q);
  await q.start();
  return q;
}

const settle = () => new Promise<void>((r) => setTimeout(r, 100));

beforeEach(() => {
  vi.clearAllMocks();
  enqueuedMessages.length = 0;
  dbTransactionFn.mockImplementation(async (cb: (tx: unknown) => Promise<void>) => { await cb(mockTx); });
  findByIdMock.mockResolvedValue(null);
});

// ─── Tests ──────────────────────────────────────────────────────────────────

describe("employeeCreate command", () => {
  it("inserts an employee with status 'probation'", async () => {
    const q = await buildQueue();
    const empId = randomUUID();
    await q.publish(COMMANDS.employeeCreate, makeMsg(COMMANDS.employeeCreate, {
      id: empId, tenantId: TENANT, employeeNo: "EMP001", fullName: "Test Employee",
      departmentId: randomUUID(), designationId: randomUUID(),
      dateOfJoining: "2025-01-15", employeeType: "permanent",
      basicMinor: 5000000, currency: "INR",
    }));
    await settle();
    expect(insertEmployeeMock).toHaveBeenCalledOnce();
    const row = insertEmployeeMock.mock.calls[0]![1] as Record<string, unknown>;
    expect(row.id).toBe(empId);
    expect(row.status).toBe("probation");
    await q.stop();
  });

  it("publishes employeeCreated event", async () => {
    const q = await buildQueue();
    await q.publish(COMMANDS.employeeCreate, makeMsg(COMMANDS.employeeCreate, {
      id: randomUUID(), tenantId: TENANT, employeeNo: "E002", fullName: "Another",
      departmentId: randomUUID(), designationId: randomUUID(),
      dateOfJoining: "2025-01-15", employeeType: "permanent",
      basicMinor: 3000000, currency: "INR",
    }));
    await settle();
    const evt = enqueuedMessages.find((m) => m.topic === EVENTS.employeeCreated);
    expect(evt).toBeDefined();
    await q.stop();
  });

  it("publishes audit event", async () => {
    const q = await buildQueue();
    await q.publish(COMMANDS.employeeCreate, makeMsg(COMMANDS.employeeCreate, {
      id: randomUUID(), tenantId: TENANT, employeeNo: "E003", fullName: "X",
      departmentId: randomUUID(), designationId: randomUUID(),
      dateOfJoining: "2025-01-15", employeeType: "permanent",
      basicMinor: 1000000, currency: "INR",
    }));
    await settle();
    const audit = enqueuedMessages.find((m) => m.topic === "audit.event.record");
    expect(audit).toBeDefined();
    expect((audit!.payload as any).action).toBe("create");
    await q.stop();
  });
});

describe("employeeConfirm command", () => {
  it("updates employee status to confirmed", async () => {
    const q = await buildQueue();
    const empId = randomUUID();
    await q.publish(COMMANDS.employeeConfirm, makeMsg(COMMANDS.employeeConfirm, {
      id: empId, tenantId: TENANT, confirmationDate: "2026-01-15",
    }));
    await settle();
    expect(updateEmployeeMock).toHaveBeenCalledOnce();
    const [, id, patch] = updateEmployeeMock.mock.calls[0]! as [unknown, string, Record<string, unknown>];
    expect(id).toBe(empId);
    expect(patch.status).toBe("confirmed");
    expect(patch.confirmationDate).toBe("2026-01-15");
    await q.stop();
  });
});

describe("employeeTransfer command", () => {
  it("inserts transfer and calls applyTransferEffect when the effective date is due", async () => {
    const q = await buildQueue();
    const empId = randomUUID();
    const toDeptId = randomUUID();
    // Past effective date -- isEffectiveDateDue(...) is due immediately, so
    // this exercises the SAME "apply now" branch as before migration 0144
    // (a future effectiveDate instead would insert as pending_effective and
    // never call applyTransferEffect at all; see effective-dating.test.ts's
    // "Bug 1" describe block for that path, and effective-scheduler.ts for
    // how a deferred transfer is later applied by the scheduler tick).
    await q.publish(COMMANDS.employeeTransfer, makeMsg(COMMANDS.employeeTransfer, {
      employeeId: empId, tenantId: TENANT,
      fromDeptId: randomUUID(), toDeptId,
      effectiveDate: "2026-06-01",
    }));
    await settle();
    expect(insertTransferMock).toHaveBeenCalledOnce();
    const [, transferRow] = insertTransferMock.mock.calls[0]! as [unknown, Record<string, unknown>];
    expect(transferRow.status).toBe("completed");

    // Bug 2 fix (version-guard parity with promotions): the actual employee
    // write now happens inside lifecycle/repo.ts's applyTransferEffect,
    // which reads the employee's current version via findVersionForUpdate
    // and writes through updateEmployeeVersioned — same optimistic-
    // concurrency guard applyPromotionEffect already used — instead of the
    // old blind-overwrite updateEmployee. applyTransferEffect is mocked as
    // a spy here (lifecycle/repo.js is fully mocked in this file); its
    // internal version-guard behaviour, including a newer conflicting
    // concurrent write throwing 409 EMPLOYEE_VERSION_CONFLICT instead of
    // being silently reverted, is exercised for real against a real DB by
    // effective-dating.test.ts's "Bug 2" describe block.
    expect(updateEmployeeMock).not.toHaveBeenCalled();
    expect(applyTransferEffectMock).toHaveBeenCalledOnce();
    const [, transferArg, actorArg] = applyTransferEffectMock.mock.calls[0]! as
      [unknown, Record<string, unknown>, string];
    expect(transferArg.employeeId).toBe(empId);
    expect(transferArg.toDeptId).toBe(toDeptId);
    expect(actorArg).toBe(ACTOR);
    await q.stop();
  });
});

describe("employeeTransferSubmitApproval command", () => {
  it("inserts transfer with pending_approval status", async () => {
    const q = await buildQueue();
    const transferId = randomUUID();
    await q.publish(COMMANDS.employeeTransferSubmitApproval, makeMsg(COMMANDS.employeeTransferSubmitApproval, {
      id: transferId, employeeId: randomUUID(), tenantId: TENANT,
      fromDeptId: randomUUID(), toDeptId: randomUUID(), effectiveDate: "2026-06-01",
    }));
    await settle();
    expect(insertTransferMock).toHaveBeenCalledOnce();
    const row = insertTransferMock.mock.calls[0]![1] as Record<string, unknown>;
    expect(row.status).toBe("pending_approval");
    await q.stop();
  });
});

describe("employeePromotionSubmitApproval command", () => {
  it("inserts promotion with pending_approval status", async () => {
    const q = await buildQueue();
    const promoId = randomUUID();
    await q.publish(COMMANDS.employeePromotionSubmitApproval, makeMsg(COMMANDS.employeePromotionSubmitApproval, {
      id: promoId, employeeId: randomUUID(), tenantId: TENANT,
      fromDesigId: randomUUID(), toDesigId: randomUUID(), effectiveDate: "2026-07-01",
    }));
    await settle();
    expect(insertPromotionMock).toHaveBeenCalledOnce();
    const row = insertPromotionMock.mock.calls[0]![1] as Record<string, unknown>;
    expect(row.status).toBe("pending_approval");
    await q.stop();
  });
});

describe("employeeSeparate command", () => {
  it("inserts separation, updates status to separated, publishes event", async () => {
    const empId = randomUUID();
    findByIdMock.mockResolvedValue({
      id: empId, tenantId: TENANT, basicMinor: 5600000n,
      dateOfJoining: "2010-01-01", pensionScheme: "GPF",
    });
    const q = await buildQueue();
    await q.publish(COMMANDS.employeeSeparate, makeMsg(COMMANDS.employeeSeparate, {
      employeeId: empId, tenantId: TENANT,
      separationType: "retirement", effectiveDate: "2026-06-30",
      encashmentDays: 200,
    }));
    await settle();
    expect(insertSeparationMock).toHaveBeenCalledOnce();
    const sepRow = insertSeparationMock.mock.calls[0]![1] as Record<string, unknown>;
    expect(sepRow.status).toBe("initiated");
    expect(sepRow.encashmentMinor).toBeGreaterThan(0n);
    expect(sepRow.gratuityMinor).toBeGreaterThan(0n); // retirement is eligible

    expect(updateEmployeeMock).toHaveBeenCalledOnce();
    const [, , patch] = updateEmployeeMock.mock.calls[0]! as [unknown, string, Record<string, unknown>];
    expect(patch.status).toBe("separated");

    const evt = enqueuedMessages.find((m) => m.topic === EVENTS.employeeSeparated);
    expect(evt).toBeDefined();
    await q.stop();
  });

  it("forfeits gratuity for resignation", async () => {
    const empId = randomUUID();
    findByIdMock.mockResolvedValue({
      id: empId, tenantId: TENANT, basicMinor: 5600000n,
      dateOfJoining: "2010-01-01", pensionScheme: "GPF",
    });
    const q = await buildQueue();
    await q.publish(COMMANDS.employeeSeparate, makeMsg(COMMANDS.employeeSeparate, {
      employeeId: empId, tenantId: TENANT,
      separationType: "resignation", effectiveDate: "2026-06-30",
      encashmentDays: 100,
    }));
    await settle();
    const sepRow = insertSeparationMock.mock.calls[0]![1] as Record<string, unknown>;
    expect(sepRow.gratuityMinor).toBe(0n); // resignation forfeits gratuity
    await q.stop();
  });
});

describe("employeeUpdate command", () => {
  it("updates non-pay fields via the plain blind-overwrite path", async () => {
    const q = await buildQueue();
    const empId = randomUUID();
    await q.publish(COMMANDS.employeeUpdate, makeMsg(COMMANDS.employeeUpdate, {
      id: empId, tenantId: TENANT,
      mobile: "9876543210", email: "test@gov.in",
      bankAccountNo: "12345678901234", bankIfsc: "SBIN0001234",
    }));
    await settle();
    // No basicMinor in this payload: the optimistic-concurrency guard is not
    // engaged, and this keeps going through the plain updateEmployee path.
    expect(updateEmployeeMock).toHaveBeenCalledOnce();
    expect(findVersionForUpdateMock).not.toHaveBeenCalled();
    expect(updateEmployeeVersionedMock).not.toHaveBeenCalled();
    const [, id, patch] = updateEmployeeMock.mock.calls[0]! as [unknown, string, Record<string, unknown>];
    expect(id).toBe(empId);
    expect(patch.mobile).toBe("9876543210");
    expect(patch.email).toBe("test@gov.in");
    await q.stop();
  });

  it("routes a basicMinor change through the optimistic-concurrency guard", async () => {
    // Guards against the basicMinor race this consumer shares with the
    // pay-matrix annual-increment consumer and both promotion consumers
    // (direct + eOffice-approved): see employee/repo.ts
    // updateEmployeeVersioned. A basicMinor-touching employeeUpdate must
    // read the row's current version fresh (findVersionForUpdate) and write
    // through the version-guarded path (updateEmployeeVersioned), never the
    // blind-overwrite updateEmployee.
    const q = await buildQueue();
    const empId = randomUUID();
    await q.publish(COMMANDS.employeeUpdate, makeMsg(COMMANDS.employeeUpdate, {
      id: empId, tenantId: TENANT,
      mobile: "9876543210", email: "test@gov.in",
      bankAccountNo: "12345678901234", bankIfsc: "SBIN0001234",
      basicMinor: "6000000",
    }));
    await settle();
    expect(updateEmployeeMock).not.toHaveBeenCalled();
    expect(findVersionForUpdateMock).toHaveBeenCalledOnce();
    expect(findVersionForUpdateMock).toHaveBeenCalledWith(expect.anything(), empId, TENANT);
    expect(updateEmployeeVersionedMock).toHaveBeenCalledOnce();
    const [, id, tenantId, expectedVersion, patch] = updateEmployeeVersionedMock.mock.calls[0]! as
      [unknown, string, string, number, Record<string, unknown>, string];
    expect(id).toBe(empId);
    expect(tenantId).toBe(TENANT);
    expect(expectedVersion).toBe(1); // from findVersionForUpdateMock's default resolved value
    expect(patch.mobile).toBe("9876543210");
    expect(patch.email).toBe("test@gov.in");
    expect(patch.basicMinor).toBe(6000000n);
    await q.stop();
  });

  it("does not apply the write when the version has changed (lost race)", async () => {
    // The concurrent-race case: another writer (e.g. a promotion) changed
    // this employee between the route publishing the command and this
    // consumer processing it. findVersionForUpdate still returns a row (the
    // employee exists), but updateEmployeeVersioned's own WHERE-version
    // guard is what would reject a stale write in the real repo — here we
    // simulate that rejection (on every attempt, since a stale read never
    // resolves itself on retry within this mocked scenario) to confirm the
    // consumer does NOT swallow it and report success; the queue's own
    // bounded retry + DLQ handling takes over instead.
    updateEmployeeVersionedMock.mockRejectedValue(
      Object.assign(new Error("employee was modified by another writer"), { status: 409, code: "EMPLOYEE_VERSION_CONFLICT" }),
    );
    const q = await buildQueue();
    const empId = randomUUID();
    await q.publish(COMMANDS.employeeUpdate, makeMsg(COMMANDS.employeeUpdate, {
      id: empId, tenantId: TENANT, basicMinor: "7000000",
    }));
    // MemoryQueue retries a failing handler up to 5 times with exponential
    // backoff (20/40/80/160/320ms ≈ 620ms total) before dead-lettering — the
    // usual 100ms `settle()` isn't enough to observe the final DLQ outcome.
    await new Promise((r) => setTimeout(r, 900));
    expect(updateEmployeeVersionedMock.mock.calls.length).toBeGreaterThanOrEqual(1);
    // The write is never silently treated as applied: no success event is
    // enqueued, and the message ends up in the queue's dead-letter queue
    // for manual review rather than being dropped.
    expect(enqueuedMessages.some((m) => m.payload && (m.payload as any).employeeId === empId)).toBe(false);
    expect(q.dlq.some((d) => d.msg.payload && (d.msg.payload as any).id === empId)).toBe(true);
    await q.stop();
  });
});
