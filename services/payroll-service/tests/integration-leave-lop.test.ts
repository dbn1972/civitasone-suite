/**
 * Integration tests: Leave approved → Payroll LOP ledger updated
 *                    Attendance marked (absent) → LOP incremented
 *
 * Verifies that cross-service events (hrms.leave.approved, hrms.attendance.marked)
 * correctly update the payroll LOP ledger via the integration consumer.
 *
 * Uses vi.mock to stub DB and outbox — no live database required.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { randomUUID } from "node:crypto";
import { MemoryQueue } from "@civitasone/queue";

// ---------------------------------------------------------------------------
// Module mocks — declared before importing the consumer (Vitest hoists vi.mock).
// ---------------------------------------------------------------------------

const {
  mockTx,
  dbTransactionFn,
  upsertLopDaysMock,
  markProcessedMock,
  fetchAttendanceLopAppliesMock,
} = vi.hoisted(() => {
  const _mockTx = {
    insert: vi.fn().mockReturnValue({ values: vi.fn().mockResolvedValue(undefined) }),
    update: vi.fn().mockReturnValue({
      set: vi.fn().mockReturnValue({ where: vi.fn().mockResolvedValue(undefined) }),
    }),
    select: vi.fn().mockReturnValue({
      from: vi.fn().mockReturnValue({
        where: vi.fn().mockReturnValue({ limit: vi.fn().mockResolvedValue([]) }),
      }),
    }),
  };
  const _dbTransactionFn = vi.fn(async (cb: (tx: unknown) => Promise<void>) => {
    await cb(_mockTx);
  });
  const _upsertLopDaysMock = vi.fn(async () => undefined);
  const _markProcessedMock = vi.fn(async () => true);
  // BUG-2 fix: gates the ledger write on the same DIC engagement exemption the
  // live-pull payroll-input feed applies. Defaults to `true` (LOP applies / not
  // exempt) so every pre-existing test below -- none of which is about
  // engagement exemption -- keeps its original behavior unmodified.
  const _fetchAttendanceLopAppliesMock = vi.fn(async () => true);
  return {
    mockTx: _mockTx,
    dbTransactionFn: _dbTransactionFn as any,
    upsertLopDaysMock: _upsertLopDaysMock as any,
    markProcessedMock: _markProcessedMock as any,
    fetchAttendanceLopAppliesMock: _fetchAttendanceLopAppliesMock as any,
  };
});

// 1. DB mock — intercept transactions.
vi.mock("../src/shared/db.js", () => ({
  scopedRead: dbTransactionFn,
  db: { transaction: dbTransactionFn },
}));

// 2. Outbox — markProcessed always succeeds (idempotency gate).
vi.mock("../src/shared/outbox.js", () => ({
  enqueue: vi.fn(async () => undefined),
  markProcessed: (...args: any[]) => markProcessedMock(...args),
}));

// 3. LOP repo — capture calls to upsertLopDays.
vi.mock("../src/modules/integration/lop-repo.js", () => ({
  upsertLopDays: (...args: any[]) => upsertLopDaysMock(...args),
}));

// 4. Statutory repo — not used for LOP tests but import may happen.
vi.mock("../src/modules/statutory/repo.js", () => ({
  insertGratuity: vi.fn(async () => undefined),
}));

// 5. Cache — no-op (imported transitively).
vi.mock("../src/shared/infra.js", () => ({
  cache: {
    invalidate: vi.fn(async () => undefined),
    makeKey: vi.fn((...parts: string[]) => parts.join(":")),
  },
}));

// 6. hrms-client — BUG-2 fix: the engagement-exemption check the consumer now
// calls before every ledger write. Mocked so these tests never make a real
// network call; see fetchAttendanceLopAppliesMock's default above.
vi.mock("../src/shared/hrms-client.js", () => ({
  fetchAttendanceLopApplies: (...args: any[]) => fetchAttendanceLopAppliesMock(...args),
}));

// ---------------------------------------------------------------------------
// Import consumer AFTER mocks are declared.
// ---------------------------------------------------------------------------
import { registerIntegrationConsumers } from "../src/modules/integration/consumer.js";
import { CONSUMED_EVENTS } from "../src/topics.js";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------
const TENANT = "10000000-aaaa-4000-8000-000000000001";
const ACTOR  = "20000000-bbbb-4000-8000-000000000001";

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
  registerIntegrationConsumers(q);
  await q.start();
  return q;
}

const settle = () => new Promise<void>((r) => setTimeout(r, 150));

// ---------------------------------------------------------------------------
beforeEach(() => {
  vi.clearAllMocks();
  markProcessedMock.mockResolvedValue(true);
  fetchAttendanceLopAppliesMock.mockResolvedValue(true);
  dbTransactionFn.mockImplementation(async (cb: (tx: unknown) => Promise<void>) => {
    await cb(mockTx);
  });
});

// ---------------------------------------------------------------------------
// TASK 1 — Leave approved → Payroll LOP ledger updated
// ---------------------------------------------------------------------------
describe("hrms.leave.approved → LOP ledger upsert", () => {
  it("calls upsertLopDays with correct month, source, and days", async () => {
    const q = await buildQueue();

    await q.publish(
      CONSUMED_EVENTS.leaveApproved,
      makeMsg(CONSUMED_EVENTS.leaveApproved, {
        employeeId: "emp-1",
        daysApplied: 3,
        fromDate: "2025-06-01",
      }),
    );
    await settle();

    expect(upsertLopDaysMock).toHaveBeenCalledOnce();
    const [tx, tenantId, employeeId, month, source, days] = upsertLopDaysMock.mock.calls[0]!;
    expect(tenantId).toBe(TENANT);
    expect(employeeId).toBe("emp-1");
    expect(month).toBe("2025-06");
    expect(source).toBe("leave");
    expect(days).toBe(3);
    await q.stop();
  });

  it("extracts month from fromDate correctly for mid-month dates", async () => {
    const q = await buildQueue();

    await q.publish(
      CONSUMED_EVENTS.leaveApproved,
      makeMsg(CONSUMED_EVENTS.leaveApproved, {
        employeeId: "emp-2",
        daysApplied: 5,
        fromDate: "2025-12-15",
      }),
    );
    await settle();

    expect(upsertLopDaysMock).toHaveBeenCalledOnce();
    const [, , , month] = upsertLopDaysMock.mock.calls[0]!;
    expect(month).toBe("2025-12");
    await q.stop();
  });

  it("skips processing on duplicate message (markProcessed returns false)", async () => {
    markProcessedMock.mockResolvedValue(false);
    const q = await buildQueue();

    await q.publish(
      CONSUMED_EVENTS.leaveApproved,
      makeMsg(CONSUMED_EVENTS.leaveApproved, {
        employeeId: "emp-1",
        daysApplied: 3,
        fromDate: "2025-06-01",
      }),
    );
    await settle();

    expect(upsertLopDaysMock).not.toHaveBeenCalled();
    await q.stop();
  });
});

// ---------------------------------------------------------------------------
// TASK 4 — Attendance marked (absent) → LOP incremented
// ---------------------------------------------------------------------------
describe("hrms.attendance.marked → LOP ledger upsert", () => {
  it("status=absent calls upsertLopDays with source 'attendance' and days 1", async () => {
    const q = await buildQueue();

    await q.publish(
      CONSUMED_EVENTS.attendanceMarked,
      makeMsg(CONSUMED_EVENTS.attendanceMarked, {
        employeeId: "emp-1",
        attendanceDate: "2025-06-15",
        status: "absent",
      }),
    );
    await settle();

    expect(upsertLopDaysMock).toHaveBeenCalledOnce();
    const [tx, tenantId, employeeId, month, source, days] = upsertLopDaysMock.mock.calls[0]!;
    expect(tenantId).toBe(TENANT);
    expect(employeeId).toBe("emp-1");
    expect(month).toBe("2025-06");
    expect(source).toBe("attendance");
    expect(days).toBe(1);
    await q.stop();
  });

  it("status=half_day also calls upsertLopDays (half-day counts as absence)", async () => {
    const q = await buildQueue();

    await q.publish(
      CONSUMED_EVENTS.attendanceMarked,
      makeMsg(CONSUMED_EVENTS.attendanceMarked, {
        employeeId: "emp-1",
        attendanceDate: "2025-06-20",
        status: "half_day",
      }),
    );
    await settle();

    expect(upsertLopDaysMock).toHaveBeenCalledOnce();
    const [, , , month, source, days] = upsertLopDaysMock.mock.calls[0]!;
    expect(month).toBe("2025-06");
    expect(source).toBe("attendance");
    expect(days).toBe(1);
    await q.stop();
  });

  it("status=present does NOT call upsertLopDays (early return)", async () => {
    const q = await buildQueue();

    await q.publish(
      CONSUMED_EVENTS.attendanceMarked,
      makeMsg(CONSUMED_EVENTS.attendanceMarked, {
        employeeId: "emp-1",
        attendanceDate: "2025-06-15",
        status: "present",
      }),
    );
    await settle();

    expect(upsertLopDaysMock).not.toHaveBeenCalled();
    await q.stop();
  });

  it("status=on_duty does NOT call upsertLopDays", async () => {
    const q = await buildQueue();

    await q.publish(
      CONSUMED_EVENTS.attendanceMarked,
      makeMsg(CONSUMED_EVENTS.attendanceMarked, {
        employeeId: "emp-1",
        attendanceDate: "2025-06-15",
        status: "on_duty",
      }),
    );
    await settle();

    expect(upsertLopDaysMock).not.toHaveBeenCalled();
    await q.stop();
  });
});

// ---------------------------------------------------------------------------
// BUG-2 fix — DIC engagement exemption (consultant/third-party/apprentice)
// must gate the LOCAL LEDGER WRITE ITSELF, not just the live-pull HRMS
// payroll-input feed. Previously, leaveApproved/attendanceMarked wrote to
// payrollLopLedger unconditionally for EVERY employee type; the payroll run
// then PREFERS the ledger over the correctly-exempting feed whenever any
// ledger row exists for the month (see payroll/consumer.ts's "M2 LOP
// double-count" comment), silently overriding the exemption. These tests
// prove upsertLopDays is skipped entirely for an exempt employee, and still
// runs normally for a non-exempt one.
// ---------------------------------------------------------------------------
describe("BUG-2: engagement exemption gates the ledger write", () => {
  it("leaveApproved: exempt employee (fetchAttendanceLopApplies=false) never reaches upsertLopDays", async () => {
    fetchAttendanceLopAppliesMock.mockResolvedValue(false);
    const q = await buildQueue();

    await q.publish(
      CONSUMED_EVENTS.leaveApproved,
      makeMsg(CONSUMED_EVENTS.leaveApproved, {
        employeeId: "consultant-1",
        daysApplied: 3,
        fromDate: "2025-06-01",
      }),
    );
    await settle();

    expect(fetchAttendanceLopAppliesMock).toHaveBeenCalledWith(TENANT, "consultant-1");
    expect(upsertLopDaysMock).not.toHaveBeenCalled();
    // A benignly-skipped (exempt) message must not be claimed either -- it's
    // not "processed", it's correctly never-applicable, matching the existing
    // attendanceMarked status-filter's same early-return-before-transaction
    // shape elsewhere in this consumer.
    expect(markProcessedMock).not.toHaveBeenCalled();
    await q.stop();
  });

  it("leaveApproved: non-exempt employee (fetchAttendanceLopApplies=true) still reaches upsertLopDays", async () => {
    fetchAttendanceLopAppliesMock.mockResolvedValue(true);
    const q = await buildQueue();

    await q.publish(
      CONSUMED_EVENTS.leaveApproved,
      makeMsg(CONSUMED_EVENTS.leaveApproved, {
        employeeId: "pay-scale-1",
        daysApplied: 3,
        fromDate: "2025-06-01",
      }),
    );
    await settle();

    expect(fetchAttendanceLopAppliesMock).toHaveBeenCalledWith(TENANT, "pay-scale-1");
    expect(upsertLopDaysMock).toHaveBeenCalledOnce();
    const [, , employeeId, , source, days] = upsertLopDaysMock.mock.calls[0]!;
    expect(employeeId).toBe("pay-scale-1");
    expect(source).toBe("leave");
    expect(days).toBe(3);
    await q.stop();
  });

  it("attendanceMarked (absent): exempt employee never reaches upsertLopDays", async () => {
    fetchAttendanceLopAppliesMock.mockResolvedValue(false);
    const q = await buildQueue();

    await q.publish(
      CONSUMED_EVENTS.attendanceMarked,
      makeMsg(CONSUMED_EVENTS.attendanceMarked, {
        employeeId: "apprentice-1",
        attendanceDate: "2025-06-15",
        status: "absent",
      }),
    );
    await settle();

    expect(fetchAttendanceLopAppliesMock).toHaveBeenCalledWith(TENANT, "apprentice-1");
    expect(upsertLopDaysMock).not.toHaveBeenCalled();
    await q.stop();
  });

  it("attendanceMarked (absent): non-exempt employee still reaches upsertLopDays", async () => {
    fetchAttendanceLopAppliesMock.mockResolvedValue(true);
    const q = await buildQueue();

    await q.publish(
      CONSUMED_EVENTS.attendanceMarked,
      makeMsg(CONSUMED_EVENTS.attendanceMarked, {
        employeeId: "pay-scale-2",
        attendanceDate: "2025-06-15",
        status: "absent",
      }),
    );
    await settle();

    expect(upsertLopDaysMock).toHaveBeenCalledOnce();
    const [, , employeeId, , source, days] = upsertLopDaysMock.mock.calls[0]!;
    expect(employeeId).toBe("pay-scale-2");
    expect(source).toBe("attendance");
    expect(days).toBe(1);
    await q.stop();
  });

  it("attendanceMarked (present): exemption check is never even reached (status filter short-circuits first)", async () => {
    const q = await buildQueue();

    await q.publish(
      CONSUMED_EVENTS.attendanceMarked,
      makeMsg(CONSUMED_EVENTS.attendanceMarked, {
        employeeId: "pay-scale-3",
        attendanceDate: "2025-06-15",
        status: "present",
      }),
    );
    await settle();

    expect(fetchAttendanceLopAppliesMock).not.toHaveBeenCalled();
    expect(upsertLopDaysMock).not.toHaveBeenCalled();
    await q.stop();
  });
});
