/**
 * Integration test: Payroll run approved → Finance GL accrual event emitted
 *
 * Verifies that when a payroll run is approved:
 *   - With totalGross > 0: `payroll.run.approved` event is emitted to the outbox
 *     containing runId, totalGrossMinor, totalNetMinor, totalEmployerContribMinor.
 *   - With grossMinor == 0: `payroll.run.approved` is NOT emitted (no-op GL accrual).
 *   - The run status transitions to "approved".
 *   - Maker-checker: approver must differ from creator.
 *
 * Uses vi.mock to stub DB, outbox, repo, and cache — no live database required.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { randomUUID } from "node:crypto";
import { MemoryQueue } from "@civitasone/queue";

// ---------------------------------------------------------------------------
// Module mocks — declared before importing the consumer.
// ---------------------------------------------------------------------------

const {
  dbTransactionFn,
  enqueuedMessages,
  findRunByIdTxMock,
  listSlipsByRunMock,
  updateRunMock,
  markProcessedMock,
  sumEmployerContribByRunMock,
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
  const _enqueuedMessages: Array<{ topic: string; eventType: string; payload: unknown }> = [];
  const _findRunByIdTxMock = vi.fn(async () => null as any);
  const _listSlipsByRunMock = vi.fn(async () => [] as any[]);
  const _updateRunMock = vi.fn(async () => undefined);
  const _markProcessedMock = vi.fn(async () => true);
  const _sumEmployerContribByRunMock = vi.fn(async () => 0n);
  return {
    mockTx: _mockTx,
    dbTransactionFn: _dbTransactionFn as any,
    enqueuedMessages: _enqueuedMessages,
    findRunByIdTxMock: _findRunByIdTxMock as any,
    listSlipsByRunMock: _listSlipsByRunMock as any,
    updateRunMock: _updateRunMock as any,
    markProcessedMock: _markProcessedMock as any,
    sumEmployerContribByRunMock: _sumEmployerContribByRunMock as any,
  };
});

// 1. DB mock.
vi.mock("../src/shared/db.js", () => ({
  db: { transaction: dbTransactionFn },
}));

// 2. Outbox — capture enqueue calls.
vi.mock("../src/shared/outbox.js", () => ({
  enqueue: vi.fn(async (_tx: unknown, msg: { topic: string; eventType: string; payload: unknown }) => {
    enqueuedMessages.push({ topic: msg.topic, eventType: msg.eventType, payload: msg.payload });
  }),
  markProcessed: (...args: any[]) => markProcessedMock(...args),
}));

// 3. Payroll repo — controlled responses.
vi.mock("../src/modules/payroll/repo.js", () => ({
  findRunByIdTx: (...args: any[]) => findRunByIdTxMock(...args),
  listSlipsByRun: (...args: any[]) => listSlipsByRunMock(...args),
  // Consumer now reads slips through the caller's already-open tx
  // (nested-transaction deadlock fix -- see
  // .claude/skills/16-production-readiness-audit.md section 1); same
  // canned mock, tx arg forwarded but never asserted on.
  listSlipsByRunTx: (...args: any[]) => listSlipsByRunMock(...args),
  updateRun: (...args: any[]) => updateRunMock(...args),
  insertRun: vi.fn(async () => undefined),
  insertStructure: vi.fn(async () => undefined),
  insertSlip: vi.fn(async () => undefined),
  listComponentsByStructure: vi.fn(async () => []),
  markSlipsPaidForRun: vi.fn(async () => undefined),
}));

// 4. Statutory repo.
vi.mock("../src/modules/statutory/repo.js", () => ({
  sumEmployerContribByRun: (...args: any[]) => sumEmployerContribByRunMock(...args),
  // Same nested-transaction deadlock fix as listSlipsByRunTx above.
  sumEmployerContribByRunTx: (...args: any[]) => sumEmployerContribByRunMock(...args),
  insertPf: vi.fn(async () => undefined),
  insertEsi: vi.fn(async () => undefined),
  insertTds: vi.fn(async () => undefined),
  insertGratuity: vi.fn(async () => undefined),
  insertGpf: vi.fn(async () => undefined),
  insertNps: vi.fn(async () => undefined),
}));

// 5. Loans repo.
vi.mock("../src/modules/loans/repo.js", () => ({
  findLoansByEmployee: vi.fn(async () => []),
}));

// 6. Integration LOP repo.
vi.mock("../src/modules/integration/lop-repo.js", () => ({
  getLopForMonth: vi.fn(async () => ({ hasLedger: false, days: 0 })),
  upsertLopDays: vi.fn(async () => undefined),
}));

// 7. Cache — no-op.
vi.mock("../src/shared/infra.js", () => ({
  cache: {
    invalidate: vi.fn(async () => undefined),
    makeKey: vi.fn((...parts: string[]) => parts.join(":")),
  },
}));

// 8. HRMS client — not called during approve.
vi.mock("../src/shared/hrms-client.js", () => ({
  fetchPayrollInput: vi.fn(async () => ({ employees: [], lopDays: {} })),
}));

// 9. Events package.
vi.mock("@civitasone/events", async (importOriginal) => {
  const actual = await importOriginal() as Record<string, unknown>;
  return {
    ...actual,
    NOTIFICATION_SEND: "notification.send",
    buildNotificationPayload: vi.fn((p: unknown) => p),
  };
});

// ---------------------------------------------------------------------------
// Import consumer AFTER mocks.
// ---------------------------------------------------------------------------
import { registerPayrollConsumers } from "../src/modules/payroll/consumer.js";
import { COMMANDS, EVENTS } from "../src/topics.js";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------
const TENANT = "10000000-aaaa-4000-8000-000000000001";
const ACTOR  = "20000000-bbbb-4000-8000-000000000001";
const APPROVER = "20000000-cccc-4000-8000-000000000002"; // maker != checker
const RUN_ID = "30000000-dddd-4000-8000-000000000001";

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
  registerPayrollConsumers(q);
  await q.start();
  return q;
}

const settle = () => new Promise<void>((r) => setTimeout(r, 200));

// ---------------------------------------------------------------------------
beforeEach(() => {
  vi.clearAllMocks();
  enqueuedMessages.length = 0;
  markProcessedMock.mockResolvedValue(true);
  dbTransactionFn.mockImplementation(async (cb: (tx: unknown) => Promise<void>) => {
    await cb({});
  });
});

// ---------------------------------------------------------------------------
// TASK 2 — Payroll run approve → Finance GL accrual event
// ---------------------------------------------------------------------------
describe("payroll.run.approve → payroll.run.approved event", () => {
  const PROCESSING_RUN = {
    id: RUN_ID,
    tenantId: TENANT,
    runNo: "RUN/2025-06/001",
    month: "2025-06",
    structureId: "struct-1",
    totalGrossMinor: 0n,
    totalNetMinor: 0n,
    currency: "INR",
    status: "processing",
    createdBy: ACTOR,
    updatedBy: ACTOR,
    approvedBy: null,
    approvedAt: null,
  };

  const SLIP_WITH_GROSS = {
    id: "slip-1",
    tenantId: TENANT,
    runId: RUN_ID,
    employeeId: "emp-1",
    employeeNo: "EMP001",
    basicMinor: 3_000_000n,
    grossMinor: 5_000_000n,
    totalDeductionsMinor: 500_000n,
    netPayMinor: 4_500_000n,
    currency: "INR",
    status: "computed",
  };

  beforeEach(() => {
    findRunByIdTxMock.mockResolvedValue({ ...PROCESSING_RUN });
    listSlipsByRunMock.mockResolvedValue([{ ...SLIP_WITH_GROSS }]);
    sumEmployerContribByRunMock.mockResolvedValue(180_000n);
  });

  it("emits payroll.run.approved with GL accrual payload when totalGross > 0", async () => {
    const q = await buildQueue();

    await q.publish(
      COMMANDS.runApprove,
      makeMsg(COMMANDS.runApprove, {
        id: RUN_ID,
        tenantId: TENANT,
        approvedBy: APPROVER,
      }),
    );
    await settle();

    const approvedEvent = enqueuedMessages.find((m) => m.topic === EVENTS.runApproved);
    expect(approvedEvent, "expected payroll.run.approved event to be emitted").toBeDefined();

    const payload = approvedEvent!.payload as Record<string, unknown>;
    expect(payload.runId).toBe(RUN_ID);
    expect(payload.month).toBe("2025-06");
    expect(payload.totalGrossMinor).toBe("5000000");
    expect(payload.totalNetMinor).toBe("4500000");
    expect(payload.totalEmployerContribMinor).toBe("180000");
    await q.stop();
  });

  it("updates run status to 'approved'", async () => {
    const q = await buildQueue();

    await q.publish(
      COMMANDS.runApprove,
      makeMsg(COMMANDS.runApprove, {
        id: RUN_ID,
        tenantId: TENANT,
        approvedBy: APPROVER,
      }),
    );
    await settle();

    expect(updateRunMock).toHaveBeenCalled();
    const updateCall = updateRunMock.mock.calls[0]!;
    const [, runId, patch] = updateCall;
    expect(runId).toBe(RUN_ID);
    expect(patch.status).toBe("approved");
    expect(patch.approvedBy).toBe(APPROVER);
    await q.stop();
  });

  it("emits a notification event on approval", async () => {
    const q = await buildQueue();

    await q.publish(
      COMMANDS.runApprove,
      makeMsg(COMMANDS.runApprove, {
        id: RUN_ID,
        tenantId: TENANT,
        approvedBy: APPROVER,
      }),
    );
    await settle();

    const notif = enqueuedMessages.find((m) => m.topic === "notification.send");
    expect(notif, "expected notification.send to be emitted").toBeDefined();
    await q.stop();
  });

  it("does NOT emit payroll.run.approved when totalGross == 0 (no slips)", async () => {
    // Return empty slips → totalGross = 0.
    listSlipsByRunMock.mockResolvedValue([]);
    sumEmployerContribByRunMock.mockResolvedValue(0n);

    const q = await buildQueue();

    await q.publish(
      COMMANDS.runApprove,
      makeMsg(COMMANDS.runApprove, {
        id: RUN_ID,
        tenantId: TENANT,
        approvedBy: APPROVER,
      }),
    );
    await settle();

    const approvedEvent = enqueuedMessages.find((m) => m.topic === EVENTS.runApproved);
    expect(approvedEvent).toBeUndefined();

    // Run status should still be approved.
    expect(updateRunMock).toHaveBeenCalled();
    const [, , patch] = updateRunMock.mock.calls[0]! as [unknown, string, Record<string, unknown>];
    expect(patch.status).toBe("approved");
    await q.stop();
  });

  it("does NOT emit payroll.run.approved when all slips have grossMinor == 0", async () => {
    listSlipsByRunMock.mockResolvedValue([
      { ...SLIP_WITH_GROSS, grossMinor: 0n, netPayMinor: 0n },
    ]);
    sumEmployerContribByRunMock.mockResolvedValue(0n);

    const q = await buildQueue();

    await q.publish(
      COMMANDS.runApprove,
      makeMsg(COMMANDS.runApprove, {
        id: RUN_ID,
        tenantId: TENANT,
        approvedBy: APPROVER,
      }),
    );
    await settle();

    const approvedEvent = enqueuedMessages.find((m) => m.topic === EVENTS.runApproved);
    expect(approvedEvent).toBeUndefined();
    await q.stop();
  });

  it("rejects self-approval (maker-checker): approvedBy === createdBy", async () => {
    const q = await buildQueue();
    let caught: Error | null = null;

    dbTransactionFn.mockImplementation(async (cb: (tx: unknown) => Promise<void>) => {
      try {
        await cb({});
      } catch (e) {
        caught = e as Error;
        throw e;
      }
    });

    await q.publish(
      COMMANDS.runApprove,
      makeMsg(COMMANDS.runApprove, {
        id: RUN_ID,
        tenantId: TENANT,
        approvedBy: ACTOR, // same as createdBy
      }),
    );
    await settle();

    // Self-approval should be rejected (DomainError thrown).
    expect(caught).not.toBeNull();
    expect((caught as any).code || (caught as any).message).toContain("SELF_APPROVAL_FORBIDDEN");

    // No approved event should be emitted.
    const approvedEvent = enqueuedMessages.find((m) => m.topic === EVENTS.runApproved);
    expect(approvedEvent).toBeUndefined();
    await q.stop();
  });
});
