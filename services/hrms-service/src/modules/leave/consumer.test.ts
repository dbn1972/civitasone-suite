/**
 * TASK 2 — Leave approval flow unit tests
 *
 * Tests the leave consumer logic in isolation using vi.mock().
 * All DB, outbox, cache, and attendance side-effects are mocked.
 *
 * Covers:
 *  - leaveApply    → inserts leave_app, publishes leaveApplied + workflow.instance.create
 *  - leaveApprove  → status "approved", debit balance, leaveApproved + notification
 *  - leaveReject   → status "rejected", notification
 *  - Balance check → DomainError "INSUFFICIENT_LEAVE_BALANCE"
 *  - Status guard  → DomainError "INVALID_STATUS_TRANSITION" (approve already-approved)
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { randomUUID } from "node:crypto";
import { MemoryQueue } from "@civitasone/queue";
import { DomainError } from "./domain.js";

// ---------------------------------------------------------------------------
// Module mocks — must be declared before importing the consumer.
// ---------------------------------------------------------------------------

// Use vi.hoisted() so these variables are available inside vi.mock factories
// (which Vitest hoists to top-of-file).
const {
  mockTx,
  dbTransactionFn,
  enqueuedMessages,
  mockAlloc,
  findAllocByIdMock,
  findLeaveAppByIdMock,
  insertLeaveAppMock,
  updateLeaveAppMock,
  debitLeaveBalanceMock,
} = vi.hoisted(() => {
  const _mockTx = {
    insert: vi.fn().mockReturnValue({ values: vi.fn().mockResolvedValue(undefined) }),
    update: vi.fn().mockReturnValue({ set: vi.fn().mockReturnValue({ where: vi.fn().mockResolvedValue(undefined) }) }),
    select: vi.fn().mockReturnValue({ from: vi.fn().mockReturnValue({ where: vi.fn().mockReturnValue({ limit: vi.fn().mockResolvedValue([]) }) }) }),
  };
  const _dbTransactionFn = vi.fn(async (cb: (tx: unknown) => Promise<void>) => {
    await cb(_mockTx);
  });
  const _enqueuedMessages: Array<{ topic: string; payload: unknown }> = [];
  const _mockAlloc = {
    id: "alloc-1",
    tenantId: "tenant-1",
    employeeId: "emp-1",
    leaveTypeId: "lt-1",
    fy: "2025-26",
    totalDays: 20,
    balanceDays: 15,
    createdAt: new Date(),
    updatedAt: new Date(),
    createdBy: "actor-1",
    updatedBy: "actor-1",
    version: 1,
  };
  const _findAllocByIdMock = vi.fn(async () => _mockAlloc);
  const _findLeaveAppByIdMock = vi.fn(async () => null as any);
  const _insertLeaveAppMock = vi.fn(async () => undefined as any);
  const _updateLeaveAppMock = vi.fn(async () => undefined as any);
  const _debitLeaveBalanceMock = vi.fn(async () => undefined as any);
  return {
    mockTx: _mockTx,
    dbTransactionFn: _dbTransactionFn as any,
    enqueuedMessages: _enqueuedMessages,
    mockAlloc: _mockAlloc,
    findAllocByIdMock: _findAllocByIdMock as any,
    findLeaveAppByIdMock: _findLeaveAppByIdMock as any,
    insertLeaveAppMock: _insertLeaveAppMock as any,
    updateLeaveAppMock: _updateLeaveAppMock as any,
    debitLeaveBalanceMock: _debitLeaveBalanceMock as any,
  };
});

// 1. Shared DB — intercept transactions.
vi.mock("../../shared/db.js", () => ({
  db: { transaction: dbTransactionFn },
}));

// 2. Outbox — track published events.
vi.mock("../../shared/outbox.js", () => ({
  enqueue: vi.fn(async (_tx: unknown, msg: { topic: string; payload: unknown }) => {
    enqueuedMessages.push({ topic: msg.topic, payload: msg.payload });
  }),
  markProcessed: vi.fn(async () => true),
}));

// 3. Leave repo — controlled responses.
vi.mock("./repo.js", () => ({
  findAllocById:    (...args: any[]) => findAllocByIdMock(...args),
  findLeaveAppById: (...args: any[]) => findLeaveAppByIdMock(...args),
  insertLeaveApp:   (...args: any[]) => insertLeaveAppMock(...args),
  updateLeaveApp:   (...args: any[]) => updateLeaveAppMock(...args),
  debitLeaveBalance: (...args: any[]) => debitLeaveBalanceMock(...args),
  // stubs for type-checker
  insertLeaveType:  vi.fn(async () => undefined),
  insertLeaveAlloc: vi.fn(async () => undefined),
}));

// 4. Cache — no-op.
vi.mock("../../shared/infra.js", () => ({
  cache: {
    invalidate: vi.fn(async () => undefined),
    makeKey: vi.fn((...parts: string[]) => parts.join(":")),
  },
}));

// 5. Attendance leave-sync — no-op.
vi.mock("../attendance/leave-sync.js", () => ({
  markLeaveDaysOnAttendance: vi.fn(async () => undefined),
}));

// ---------------------------------------------------------------------------
// Now import the consumer AFTER mocks are declared.
// ---------------------------------------------------------------------------
import { registerLeaveConsumers } from "./consumer.js";
import { COMMANDS, EVENTS } from "../../topics.js";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------
const TENANT   = "10000000-aaaa-4000-8000-000000000001";
const ACTOR    = "20000000-bbbb-4000-8000-000000000001";
const EMP      = "30000000-cccc-4000-8000-000000000001";
const ALLOC_ID = "alloc-1";
const LT_ID    = "40000000-dddd-4000-8000-000000000001";

function makeMsg(type: string, payload: Record<string, unknown>) {
  return {
    messageId: randomUUID(),
    type,
    tenantId: TENANT,
    actorId: ACTOR,
    correlationId: `corr-${randomUUID()}`,
    schemaVersion: "1.0",
    payload,
  };
}

async function buildQueue(): Promise<MemoryQueue> {
  const q = new MemoryQueue();
  registerLeaveConsumers(q);
  await q.start();
  return q;
}

/** Wait for all in-flight async handlers to drain. */
const settle = () => new Promise<void>((r) => setTimeout(r, 100));

// ---------------------------------------------------------------------------
beforeEach(() => {
  vi.clearAllMocks();
  enqueuedMessages.length = 0;

  // Restore default alloc with sufficient balance.
  findAllocByIdMock.mockResolvedValue({ ...mockAlloc });

  // Default: leave app not found (overridden per test).
  findLeaveAppByIdMock.mockResolvedValue(null);

  // db.transaction re-set to fire the callback by default.
  dbTransactionFn.mockImplementation(async (cb: (tx: unknown) => Promise<void>) => {
    await cb(mockTx);
  });
});

// ---------------------------------------------------------------------------
describe("leaveApply command", () => {
  it("inserts leave_app with status 'pending'", async () => {
    const q = await buildQueue();
    const appId = randomUUID();
    await q.publish(
      COMMANDS.leaveApply,
      makeMsg(COMMANDS.leaveApply, {
        id: appId, tenantId: TENANT, employeeId: EMP,
        leaveTypeId: LT_ID, allocId: ALLOC_ID,
        fromDate: "2025-06-01", toDate: "2025-06-03", daysApplied: 3,
      }),
    );
    await settle();
    expect(insertLeaveAppMock).toHaveBeenCalledOnce();
    const insertedRow = insertLeaveAppMock.mock.calls[0]![1] as Record<string, unknown>;
    expect(insertedRow.id).toBe(appId);
    expect(insertedRow.status).toBe("pending");
    await q.stop();
  });

  it("publishes leaveApplied event", async () => {
    const q = await buildQueue();
    const appId = randomUUID();
    await q.publish(
      COMMANDS.leaveApply,
      makeMsg(COMMANDS.leaveApply, {
        id: appId, tenantId: TENANT, employeeId: EMP,
        leaveTypeId: LT_ID, allocId: ALLOC_ID,
        fromDate: "2025-06-01", toDate: "2025-06-03", daysApplied: 3,
      }),
    );
    await settle();
    const leaveApplied = enqueuedMessages.find((m) => m.topic === EVENTS.leaveApplied);
    expect(leaveApplied).toBeDefined();
    expect((leaveApplied!.payload as Record<string, unknown>).leaveAppId).toBe(appId);
    await q.stop();
  });

  it("publishes workflow.instance.create event", async () => {
    const q = await buildQueue();
    await q.publish(
      COMMANDS.leaveApply,
      makeMsg(COMMANDS.leaveApply, {
        id: randomUUID(), tenantId: TENANT, employeeId: EMP,
        leaveTypeId: LT_ID, allocId: ALLOC_ID,
        fromDate: "2025-06-01", toDate: "2025-06-05", daysApplied: 5,
      }),
    );
    await settle();
    const wfCreate = enqueuedMessages.find((m) => m.topic === "workflow.instance.create");
    expect(wfCreate).toBeDefined();
    const wfPayload = wfCreate!.payload as Record<string, unknown>;
    expect(wfPayload.definitionCode).toBe("leave_approval");
    expect(wfPayload.refType).toBe("leave_app");
    await q.stop();
  });

  it("throws DomainError INSUFFICIENT_LEAVE_BALANCE when daysApplied > balanceDays", async () => {
    // Balance is 15, requesting 20.
    findAllocByIdMock.mockResolvedValue({ ...mockAlloc, balanceDays: 15 });
    const q = await buildQueue();

    let caught: Error | null = null;
    dbTransactionFn.mockImplementation(async (cb: (tx: unknown) => Promise<void>) => {
      try {
        await cb(mockTx);
      } catch (e) {
        caught = e as Error;
        throw e;
      }
    });

    await q.publish(
      COMMANDS.leaveApply,
      makeMsg(COMMANDS.leaveApply, {
        id: randomUUID(), tenantId: TENANT, employeeId: EMP,
        leaveTypeId: LT_ID, allocId: ALLOC_ID,
        fromDate: "2025-06-01", toDate: "2025-06-22", daysApplied: 20, // > balance of 15
      }),
    );
    await settle();
    expect(caught).not.toBeNull();
    expect(caught).toBeInstanceOf(DomainError);
    expect((caught as unknown as DomainError).code).toBe("INSUFFICIENT_LEAVE_BALANCE");
    await q.stop();
  });
});

// ---------------------------------------------------------------------------
describe("leaveApprove command", () => {
  const PENDING_APP = {
    id: "app-1",
    tenantId: TENANT,
    employeeId: EMP,
    leaveTypeId: LT_ID,
    allocId: ALLOC_ID,
    fromDate: "2025-06-01",
    toDate: "2025-06-03",
    daysApplied: 3,
    reason: null,
    approvedBy: null,
    status: "pending",
    createdAt: new Date(),
    updatedAt: new Date(),
    createdBy: ACTOR,
    updatedBy: ACTOR,
    version: 1,
  };

  beforeEach(() => {
    findLeaveAppByIdMock.mockResolvedValue({ ...PENDING_APP });
  });

  it("updates leave app status to 'approved'", async () => {
    const q = await buildQueue();
    await q.publish(
      COMMANDS.leaveApprove,
      makeMsg(COMMANDS.leaveApprove, { id: "app-1", tenantId: TENANT, approvedBy: ACTOR }),
    );
    await settle();
    expect(updateLeaveAppMock).toHaveBeenCalledOnce();
    const patch = updateLeaveAppMock.mock.calls[0]![2] as Record<string, unknown>;
    expect(patch.status).toBe("approved");
    await q.stop();
  });

  it("debits leave balance after approval", async () => {
    const q = await buildQueue();
    await q.publish(
      COMMANDS.leaveApprove,
      makeMsg(COMMANDS.leaveApprove, { id: "app-1", tenantId: TENANT, approvedBy: ACTOR }),
    );
    await settle();
    expect(debitLeaveBalanceMock).toHaveBeenCalledOnce();
    const [, allocId, days] = debitLeaveBalanceMock.mock.calls[0]! as [unknown, string, number];
    expect(allocId).toBe(ALLOC_ID);
    expect(days).toBe(3);
    await q.stop();
  });

  it("publishes leaveApproved event", async () => {
    const q = await buildQueue();
    await q.publish(
      COMMANDS.leaveApprove,
      makeMsg(COMMANDS.leaveApprove, { id: "app-1", tenantId: TENANT, approvedBy: ACTOR }),
    );
    await settle();
    const approved = enqueuedMessages.find((m) => m.topic === EVENTS.leaveApproved);
    expect(approved).toBeDefined();
    expect((approved!.payload as Record<string, unknown>).leaveAppId).toBe("app-1");
    await q.stop();
  });

  it("publishes notification on approval", async () => {
    const q = await buildQueue();
    await q.publish(
      COMMANDS.leaveApprove,
      makeMsg(COMMANDS.leaveApprove, { id: "app-1", tenantId: TENANT, approvedBy: ACTOR }),
    );
    await settle();
    const notif = enqueuedMessages.find((m) => m.topic === "notification.send");
    expect(notif).toBeDefined();
    await q.stop();
  });

  it("throws DomainError INVALID_STATUS_TRANSITION when approving an already-approved leave", async () => {
    findLeaveAppByIdMock.mockResolvedValue({ ...PENDING_APP, status: "approved" });
    const q = await buildQueue();

    let caught: Error | null = null;
    dbTransactionFn.mockImplementation(async (cb: (tx: unknown) => Promise<void>) => {
      try {
        await cb(mockTx);
      } catch (e) {
        caught = e as Error;
        throw e;
      }
    });

    await q.publish(
      COMMANDS.leaveApprove,
      makeMsg(COMMANDS.leaveApprove, { id: "app-1", tenantId: TENANT, approvedBy: ACTOR }),
    );
    await settle();
    expect(caught).not.toBeNull();
    expect(caught).toBeInstanceOf(DomainError);
    expect((caught as unknown as DomainError).code).toBe("INVALID_STATUS_TRANSITION");
    await q.stop();
  });
});

// ---------------------------------------------------------------------------
describe("leaveReject command", () => {
  const PENDING_APP = {
    id: "app-2",
    tenantId: TENANT,
    employeeId: EMP,
    leaveTypeId: LT_ID,
    allocId: ALLOC_ID,
    fromDate: "2025-07-01",
    toDate: "2025-07-02",
    daysApplied: 2,
    reason: null,
    approvedBy: null,
    status: "pending",
    createdAt: new Date(),
    updatedAt: new Date(),
    createdBy: ACTOR,
    updatedBy: ACTOR,
    version: 1,
  };

  beforeEach(() => {
    findLeaveAppByIdMock.mockResolvedValue({ ...PENDING_APP });
  });

  it("updates leave app status to 'rejected'", async () => {
    const q = await buildQueue();
    await q.publish(
      COMMANDS.leaveReject,
      makeMsg(COMMANDS.leaveReject, {
        id: "app-2", tenantId: TENANT, rejectedBy: ACTOR, reason: "Not approved",
      }),
    );
    await settle();
    expect(updateLeaveAppMock).toHaveBeenCalled();
    const rejectCall = updateLeaveAppMock.mock.calls.find(
      (c: any[]) => (c[2] as Record<string, unknown>)?.status === "rejected",
    );
    expect(rejectCall).toBeDefined();
    expect((rejectCall![2] as Record<string, unknown>).status).toBe("rejected");
    await q.stop();
  });

  it("publishes notification on rejection", async () => {
    const q = await buildQueue();
    await q.publish(
      COMMANDS.leaveReject,
      makeMsg(COMMANDS.leaveReject, {
        id: "app-2", tenantId: TENANT, rejectedBy: ACTOR, reason: "Policy violation",
      }),
    );
    await settle();
    const notif = enqueuedMessages.find((m) => m.topic === "notification.send");
    expect(notif).toBeDefined();
    await q.stop();
  });

  it("does NOT publish leaveApproved event on rejection", async () => {
    const q = await buildQueue();
    await q.publish(
      COMMANDS.leaveReject,
      makeMsg(COMMANDS.leaveReject, {
        id: "app-2", tenantId: TENANT, rejectedBy: ACTOR, reason: "No reason",
      }),
    );
    await settle();
    const approved = enqueuedMessages.find((m) => m.topic === EVENTS.leaveApproved);
    expect(approved).toBeUndefined();
    await q.stop();
  });

  it("does NOT debit leave balance on rejection", async () => {
    const q = await buildQueue();
    await q.publish(
      COMMANDS.leaveReject,
      makeMsg(COMMANDS.leaveReject, {
        id: "app-2", tenantId: TENANT, rejectedBy: ACTOR, reason: "No reason",
      }),
    );
    await settle();
    expect(debitLeaveBalanceMock).not.toHaveBeenCalled();
    await q.stop();
  });
});
