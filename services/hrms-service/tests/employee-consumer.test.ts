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
  };
});

vi.mock("../src/shared/db.js", () => ({ db: { transaction: dbTransactionFn } }));
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
}));
vi.mock("../src/modules/lifecycle/repo.js", () => ({
  insertTransfer: (...a: any[]) => insertTransferMock(...a),
  insertSeparation: (...a: any[]) => insertSeparationMock(...a),
  insertPromotion: (...a: any[]) => insertPromotionMock(...a),
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
  it("inserts transfer and updates employee department", async () => {
    const q = await buildQueue();
    const empId = randomUUID();
    const toDeptId = randomUUID();
    await q.publish(COMMANDS.employeeTransfer, makeMsg(COMMANDS.employeeTransfer, {
      employeeId: empId, tenantId: TENANT,
      fromDeptId: randomUUID(), toDeptId,
      effectiveDate: "2026-06-01",
    }));
    await settle();
    expect(insertTransferMock).toHaveBeenCalledOnce();
    expect(updateEmployeeMock).toHaveBeenCalledOnce();
    const [, id, patch] = updateEmployeeMock.mock.calls[0]! as [unknown, string, Record<string, unknown>];
    expect(id).toBe(empId);
    expect(patch.departmentId).toBe(toDeptId);
    expect(patch.status).toBe("transferred");
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
  it("updates employee fields", async () => {
    const q = await buildQueue();
    const empId = randomUUID();
    await q.publish(COMMANDS.employeeUpdate, makeMsg(COMMANDS.employeeUpdate, {
      id: empId, tenantId: TENANT,
      mobile: "9876543210", email: "test@gov.in",
      bankAccountNo: "12345678901234", bankIfsc: "SBIN0001234",
      basicMinor: "6000000",
    }));
    await settle();
    expect(updateEmployeeMock).toHaveBeenCalledOnce();
    const [, id, patch] = updateEmployeeMock.mock.calls[0]! as [unknown, string, Record<string, unknown>];
    expect(id).toBe(empId);
    expect(patch.mobile).toBe("9876543210");
    expect(patch.email).toBe("test@gov.in");
    expect(patch.basicMinor).toBe(6000000n);
    await q.stop();
  });
});
