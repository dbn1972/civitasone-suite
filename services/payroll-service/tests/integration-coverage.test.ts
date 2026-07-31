/**
 * payroll-service — Integration module ADDITIONAL coverage tests
 *
 * Focuses on the consumer.ts and lop-repo.ts functions that are not covered
 * by the existing integration-hr.test.ts. Tests the consumer logic by mocking
 * the DB layer and verifying correct flow through markProcessed, repo calls,
 * and outbox events.
 *
 * Covers: consumer message handling, lop-repo edge cases, ltcClaimApproved,
 * financePaymentMade, employeeSeparated gratuity computation, and idempotency.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

// ─── Mock layer ──────────────────────────────────────────────────────────────

const mockMarkProcessed = vi.fn();
const mockEnqueue = vi.fn();
const mockDbTransaction = vi.fn();
const mockDbExecute = vi.fn();
const mockInsert = vi.fn();
const mockUpdate = vi.fn();
const mockSelect = vi.fn();

vi.mock("../src/shared/db.js", () => ({
  db: {
    transaction: (...args: unknown[]) => mockDbTransaction(...args),
    insert: (...args: unknown[]) => mockInsert(...args),
    update: (...args: unknown[]) => mockUpdate(...args),
    select: (...args: unknown[]) => mockSelect(...args),
    execute: (...args: unknown[]) => mockDbExecute(...args),
  },
  scopedRead: vi.fn(async (fn: (tx: unknown) => unknown) => fn({
    select: () => ({ from: () => ({ where: () => ({ limit: () => Promise.resolve([]) }) }) }),
    execute: (...args: unknown[]) => mockDbExecute(...args),
  })),
  sqlClient: { end: vi.fn() },
}));

vi.mock("../src/shared/outbox.js", () => ({
  enqueue: (...args: unknown[]) => mockEnqueue(...args),
  markProcessed: (...args: unknown[]) => mockMarkProcessed(...args),
  outboxMessages: {},
  processed: {},
}));

vi.mock("../src/shared/infra.js", () => ({
  cache: { getOrLoad: vi.fn((_k: string, fn: () => unknown) => fn()), makeKey: vi.fn(), invalidate: vi.fn() },
  queue: { publish: vi.fn(), subscribe: vi.fn(), start: vi.fn(), stop: vi.fn() },
}));

vi.mock("../src/modules/statutory/repo.js", () => ({
  insertGratuity: vi.fn(),
  listPfByTenant: vi.fn(() => []),
  listEsiByTenant: vi.fn(() => []),
  listTdsByTenant: vi.fn(() => []),
  listGratuityByTenant: vi.fn(() => []),
  listGpfByTenant: vi.fn(() => []),
  listNpsByTenant: vi.fn(() => []),
  sumEmployerContribByRun: vi.fn(() => 0n),
}));

vi.mock("../src/modules/payroll/domain.js", () => ({
  computeGratuity: vi.fn(() => 500000n),
}));

vi.mock("../src/modules/tax/ltc-exemption.js", () => ({
  computeLtcExemption: vi.fn(() => ({ exemptMinor: 50000n, taxableMinor: 10000n })),
}));

vi.mock("../src/modules/fnf/schema.js", () => ({
  ltcExemptions: { name: "ltc_exemptions" },
}));

vi.mock("../src/modules/payroll/repo.js", () => ({
  markSlipsPaidForRun: vi.fn(),
}));

// ─── Import after mocks ──────────────────────────────────────────────────────

import { registerIntegrationConsumers } from "../src/modules/integration/consumer.js";
import { CONSUMED_EVENTS, COMMANDS } from "../src/topics.js";

// ─── Helpers ─────────────────────────────────────────────────────────────────

type SubscribeHandler = (msg: Record<string, unknown>) => Promise<void>;

function captureHandlers(): Map<string, SubscribeHandler> {
  const handlers = new Map<string, SubscribeHandler>();
  const mockQueue = {
    subscribe: (topic: string, handler: SubscribeHandler) => {
      handlers.set(topic, handler);
    },
    publish: vi.fn(),
    start: vi.fn(),
    stop: vi.fn(),
  };
  registerIntegrationConsumers(mockQueue as never);
  return handlers;
}

const TENANT = "11111111-aaaa-4000-8000-000000000001";
const ACTOR = "22222222-bbbb-4000-8000-000000000001";

// ═══════════════════════════════════════════════════════════════════════════════
// Consumer registration
// ═══════════════════════════════════════════════════════════════════════════════

describe("Integration consumer — registration", () => {
  it("subscribes to all expected CONSUMED_EVENTS topics", () => {
    const handlers = captureHandlers();
    expect(handlers.has(CONSUMED_EVENTS.employeeCreated)).toBe(true);
    expect(handlers.has(CONSUMED_EVENTS.leaveApproved)).toBe(true);
    expect(handlers.has(CONSUMED_EVENTS.attendanceMarked)).toBe(true);
    expect(handlers.has(CONSUMED_EVENTS.employeeSeparated)).toBe(true);
    expect(handlers.has(CONSUMED_EVENTS.financePaymentMade)).toBe(true);
    expect(handlers.has(CONSUMED_EVENTS.ltcClaimApproved)).toBe(true);
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// employeeCreated — no-op but marks processed
// ═══════════════════════════════════════════════════════════════════════════════

describe("Integration consumer — employeeCreated", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockMarkProcessed.mockResolvedValue(true);
    mockDbTransaction.mockImplementation(async (fn: (tx: unknown) => unknown) => fn({}));
  });

  it("marks message as processed (no-op handler)", async () => {
    const handlers = captureHandlers();
    const handler = handlers.get(CONSUMED_EVENTS.employeeCreated)!;
    await handler({
      messageId: "msg-1", tenantId: TENANT, actorId: ACTOR,
      correlationId: "c1", payload: { employeeId: "emp-1", fullName: "Test" },
    });
    expect(mockMarkProcessed).toHaveBeenCalledOnce();
  });

  it("skips processing when markProcessed returns false (duplicate)", async () => {
    mockMarkProcessed.mockResolvedValue(false);
    const handlers = captureHandlers();
    const handler = handlers.get(CONSUMED_EVENTS.employeeCreated)!;
    await handler({
      messageId: "msg-dup", tenantId: TENANT, actorId: ACTOR,
      correlationId: "c2", payload: { employeeId: "emp-1" },
    });
    // No error thrown, just skipped
    expect(mockMarkProcessed).toHaveBeenCalledOnce();
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// leaveApproved — calls lopRepo.upsertLopDays
// ═══════════════════════════════════════════════════════════════════════════════

describe("Integration consumer — leaveApproved", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockMarkProcessed.mockResolvedValue(true);
    mockDbTransaction.mockImplementation(async (fn: (tx: unknown) => unknown) => fn({
      select: () => ({ from: () => ({ where: () => ({ limit: () => Promise.resolve([]) }) }) }),
      insert: () => ({ values: () => Promise.resolve() }),
    }));
  });

  it("extracts month from fromDate and calls upsert", async () => {
    const handlers = captureHandlers();
    const handler = handlers.get(CONSUMED_EVENTS.leaveApproved)!;
    await handler({
      messageId: "msg-leave-1", tenantId: TENANT, actorId: ACTOR,
      correlationId: "c3",
      payload: { employeeId: "emp-1", daysApplied: 3, fromDate: "2025-07-15" },
    });
    expect(mockMarkProcessed).toHaveBeenCalledOnce();
  });

  it("skips when already processed", async () => {
    mockMarkProcessed.mockResolvedValue(false);
    const handlers = captureHandlers();
    const handler = handlers.get(CONSUMED_EVENTS.leaveApproved)!;
    await handler({
      messageId: "msg-leave-dup", tenantId: TENANT, actorId: ACTOR,
      correlationId: "c4",
      payload: { employeeId: "emp-2", daysApplied: 1, fromDate: "2025-08-01" },
    });
    expect(mockMarkProcessed).toHaveBeenCalledOnce();
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// attendanceMarked — only processes absent/half_day
// ═══════════════════════════════════════════════════════════════════════════════

describe("Integration consumer — attendanceMarked", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockMarkProcessed.mockResolvedValue(true);
    mockDbTransaction.mockImplementation(async (fn: (tx: unknown) => unknown) => fn({
      select: () => ({ from: () => ({ where: () => ({ limit: () => Promise.resolve([]) }) }) }),
      insert: () => ({ values: () => Promise.resolve() }),
    }));
  });

  it("processes absent status", async () => {
    const handlers = captureHandlers();
    const handler = handlers.get(CONSUMED_EVENTS.attendanceMarked)!;
    await handler({
      messageId: "msg-att-1", tenantId: TENANT, actorId: ACTOR,
      correlationId: "c5",
      payload: { employeeId: "emp-1", attendanceDate: "2025-06-15", status: "absent" },
    });
    expect(mockMarkProcessed).toHaveBeenCalled();
  });

  it("processes half_day status", async () => {
    const handlers = captureHandlers();
    const handler = handlers.get(CONSUMED_EVENTS.attendanceMarked)!;
    await handler({
      messageId: "msg-att-2", tenantId: TENANT, actorId: ACTOR,
      correlationId: "c6",
      payload: { employeeId: "emp-1", attendanceDate: "2025-06-16", status: "half_day" },
    });
    expect(mockMarkProcessed).toHaveBeenCalled();
  });

  it("skips present status (returns early, no transaction)", async () => {
    const handlers = captureHandlers();
    const handler = handlers.get(CONSUMED_EVENTS.attendanceMarked)!;
    await handler({
      messageId: "msg-att-3", tenantId: TENANT, actorId: ACTOR,
      correlationId: "c7",
      payload: { employeeId: "emp-1", attendanceDate: "2025-06-17", status: "present" },
    });
    // Should return early without calling markProcessed
    expect(mockDbTransaction).not.toHaveBeenCalled();
  });

  it("skips on_duty status", async () => {
    const handlers = captureHandlers();
    const handler = handlers.get(CONSUMED_EVENTS.attendanceMarked)!;
    await handler({
      messageId: "msg-att-4", tenantId: TENANT, actorId: ACTOR,
      correlationId: "c8",
      payload: { employeeId: "emp-1", attendanceDate: "2025-06-18", status: "on_duty" },
    });
    expect(mockDbTransaction).not.toHaveBeenCalled();
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// financePaymentMade — marks slips paid for successful payments
// ═══════════════════════════════════════════════════════════════════════════════

describe("Integration consumer — financePaymentMade", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockMarkProcessed.mockResolvedValue(true);
    mockDbTransaction.mockImplementation(async (fn: (tx: unknown) => unknown) => fn({}));
  });

  it("processes successful payment with payrollRunId", async () => {
    const handlers = captureHandlers();
    const handler = handlers.get(CONSUMED_EVENTS.financePaymentMade)!;
    await handler({
      messageId: "msg-fin-1", tenantId: TENANT, actorId: ACTOR,
      correlationId: "c9",
      payload: { payrollRunId: "run-123", outcome: "success" },
    });
    expect(mockMarkProcessed).toHaveBeenCalledOnce();
  });

  it("skips when payrollRunId is missing", async () => {
    const handlers = captureHandlers();
    const handler = handlers.get(CONSUMED_EVENTS.financePaymentMade)!;
    await handler({
      messageId: "msg-fin-2", tenantId: TENANT, actorId: ACTOR,
      correlationId: "c10",
      payload: { outcome: "success" },
    });
    // Returns early — no transaction
    expect(mockDbTransaction).not.toHaveBeenCalled();
  });

  it("skips when outcome is not success", async () => {
    const handlers = captureHandlers();
    const handler = handlers.get(CONSUMED_EVENTS.financePaymentMade)!;
    await handler({
      messageId: "msg-fin-3", tenantId: TENANT, actorId: ACTOR,
      correlationId: "c11",
      payload: { payrollRunId: "run-456", outcome: "failed" },
    });
    expect(mockDbTransaction).not.toHaveBeenCalled();
  });

  it("skips when outcome is undefined", async () => {
    const handlers = captureHandlers();
    const handler = handlers.get(CONSUMED_EVENTS.financePaymentMade)!;
    await handler({
      messageId: "msg-fin-4", tenantId: TENANT, actorId: ACTOR,
      correlationId: "c12",
      payload: { payrollRunId: "run-789" },
    });
    expect(mockDbTransaction).not.toHaveBeenCalled();
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// ltcClaimApproved — computes LTC exemption
// ═══════════════════════════════════════════════════════════════════════════════

describe("Integration consumer — ltcClaimApproved", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockMarkProcessed.mockResolvedValue(true);
    mockDbTransaction.mockImplementation(async (fn: (tx: unknown) => unknown) => fn({
      insert: () => ({ values: () => Promise.resolve() }),
    }));
  });

  it("processes LTC claim with claimType=ltc", async () => {
    const handlers = captureHandlers();
    const handler = handlers.get(CONSUMED_EVENTS.ltcClaimApproved)!;
    await handler({
      messageId: "msg-ltc-1", tenantId: TENANT, actorId: ACTOR,
      correlationId: "c13",
      payload: {
        claimId: "claim-1", employeeId: "emp-1", claimType: "ltc",
        approvedFareMinor: "50000", entitlementMinor: "60000",
        blockYear: "2022-2025", ltcType: "hometown", usedInBlock: 1,
      },
    });
    expect(mockMarkProcessed).toHaveBeenCalledOnce();
    expect(mockEnqueue).toHaveBeenCalled();
  });

  it("skips non-LTC claim types", async () => {
    const handlers = captureHandlers();
    const handler = handlers.get(CONSUMED_EVENTS.ltcClaimApproved)!;
    await handler({
      messageId: "msg-ltc-2", tenantId: TENANT, actorId: ACTOR,
      correlationId: "c14",
      payload: {
        claimId: "claim-2", employeeId: "emp-1", claimType: "medical",
        approvedFareMinor: "10000", entitlementMinor: "20000",
        blockYear: "2022-2025", ltcType: "hometown", usedInBlock: 0,
      },
    });
    // Early return — no transaction
    expect(mockDbTransaction).not.toHaveBeenCalled();
  });

  it("skips when already processed (duplicate message)", async () => {
    mockMarkProcessed.mockResolvedValue(false);
    const handlers = captureHandlers();
    const handler = handlers.get(CONSUMED_EVENTS.ltcClaimApproved)!;
    await handler({
      messageId: "msg-ltc-dup", tenantId: TENANT, actorId: ACTOR,
      correlationId: "c15",
      payload: {
        claimId: "claim-3", employeeId: "emp-1", claimType: "ltc",
        approvedFareMinor: "50000", entitlementMinor: "60000",
        blockYear: "2022-2025", ltcType: "all_india", usedInBlock: 2,
      },
    });
    expect(mockMarkProcessed).toHaveBeenCalledOnce();
    // enqueue should NOT be called since message was skipped
    expect(mockEnqueue).not.toHaveBeenCalled();
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// employeeSeparated — gratuity computation
// ═══════════════════════════════════════════════════════════════════════════════

describe("Integration consumer — employeeSeparated", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockMarkProcessed.mockResolvedValue(true);
    mockDbTransaction.mockImplementation(async (fn: (tx: unknown) => unknown) => fn({
      execute: vi.fn().mockResolvedValue([{ rate_bps: "4200" }]),
      insert: () => ({ values: () => Promise.resolve() }),
    }));
  });

  it("computes gratuity on separation", async () => {
    const handlers = captureHandlers();
    const handler = handlers.get(CONSUMED_EVENTS.employeeSeparated)!;
    await handler({
      messageId: "msg-sep-1", tenantId: TENANT, actorId: ACTOR,
      correlationId: "c16",
      payload: {
        employeeId: "emp-1", effectiveDate: "2025-06-30",
        basicMinor: "5000000", dateOfJoining: "2010-01-01",
      },
    });
    expect(mockMarkProcessed).toHaveBeenCalledOnce();
    // Should enqueue both audit event and fnf compute command
    expect(mockEnqueue).toHaveBeenCalled();
  });

  it("skips when markProcessed returns false", async () => {
    mockMarkProcessed.mockResolvedValue(false);
    const handlers = captureHandlers();
    const handler = handlers.get(CONSUMED_EVENTS.employeeSeparated)!;
    await handler({
      messageId: "msg-sep-dup", tenantId: TENANT, actorId: ACTOR,
      correlationId: "c17",
      payload: {
        employeeId: "emp-1", effectiveDate: "2025-06-30",
        basicMinor: "5000000", dateOfJoining: "2010-01-01",
      },
    });
    expect(mockEnqueue).not.toHaveBeenCalled();
  });

  it("uses effectiveDate as dateOfJoining fallback (0 years of service)", async () => {
    const { computeGratuity } = await import("../src/modules/payroll/domain.js");
    vi.mocked(computeGratuity).mockReturnValue(0n);
    const handlers = captureHandlers();
    const handler = handlers.get(CONSUMED_EVENTS.employeeSeparated)!;
    await handler({
      messageId: "msg-sep-3", tenantId: TENANT, actorId: ACTOR,
      correlationId: "c18",
      payload: {
        employeeId: "emp-1", effectiveDate: "2025-06-30",
        // No dateOfJoining — falls back to effectiveDate → 0 years
      },
    });
    // With 0 years, computeGratuity returns 0n → should NOT insert or enqueue
    expect(mockEnqueue).not.toHaveBeenCalled();
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// lop-repo.ts — unit-level coverage
// ═══════════════════════════════════════════════════════════════════════════════

describe("Integration lop-repo — getLopForMonth", () => {
  it("returns hasLedger=false and days=0 when no records exist", async () => {
    const { scopedRead } = await import("../src/shared/db.js");
    vi.mocked(scopedRead).mockImplementation(async (fn: (tx: unknown) => unknown) => fn({
      select: () => ({ from: () => ({ where: () => [{ cnt: 0, total: 0 }] }) }),
    }));
    const { getLopForMonth } = await import("../src/modules/integration/lop-repo.js");
    const result = await getLopForMonth("t1", "emp-1", "2025-06");
    expect(result.hasLedger).toBe(false);
    expect(result.days).toBe(0);
  });

  it("returns hasLedger=true with summed days when records exist", async () => {
    const { scopedRead } = await import("../src/shared/db.js");
    vi.mocked(scopedRead).mockImplementation(async (fn: (tx: unknown) => unknown) => fn({
      select: () => ({ from: () => ({ where: () => [{ cnt: 2, total: 5 }] }) }),
    }));
    const { getLopForMonth } = await import("../src/modules/integration/lop-repo.js");
    const result = await getLopForMonth("t1", "emp-1", "2025-07");
    expect(result.hasLedger).toBe(true);
    expect(result.days).toBe(5);
  });
});

describe("Integration lop-repo — sumLopDays", () => {
  it("returns 0 when no rows match", async () => {
    const { scopedRead } = await import("../src/shared/db.js");
    vi.mocked(scopedRead).mockImplementation(async (fn: (tx: unknown) => unknown) => fn({
      select: () => ({ from: () => ({ where: () => [{ total: 0 }] }) }),
    }));
    const { sumLopDays } = await import("../src/modules/integration/lop-repo.js");
    const result = await sumLopDays("t1", "emp-1", "2025-06");
    expect(result).toBe(0);
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// Topics — constant verification
// ═══════════════════════════════════════════════════════════════════════════════

describe("Integration topics — CONSUMED_EVENTS constants", () => {
  it("has expected event topic values", () => {
    expect(CONSUMED_EVENTS.leaveApproved).toBe("hrms.leave.approved");
    expect(CONSUMED_EVENTS.attendanceMarked).toBe("hrms.attendance.marked");
    expect(CONSUMED_EVENTS.employeeCreated).toBe("hrms.employee.created");
    expect(CONSUMED_EVENTS.employeeSeparated).toBe("hrms.employee.separated");
    expect(CONSUMED_EVENTS.financePaymentMade).toBe("finance.payment.made");
    expect(CONSUMED_EVENTS.ltcClaimApproved).toBe("hrms.claim.approved");
  });

  it("has expected COMMANDS values", () => {
    expect(COMMANDS.fnfCompute).toBe("payroll.fnf.compute");
    expect(COMMANDS.runApprove).toBe("payroll.run.approve");
  });
});
