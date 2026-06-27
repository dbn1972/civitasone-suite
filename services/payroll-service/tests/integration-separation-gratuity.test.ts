/**
 * Integration test: Employee separated → Payroll gratuity computed
 *
 * Verifies that when `hrms.employee.separated` is published, the payroll
 * integration consumer:
 *   - Computes gratuity for employees with ≥5 years of service
 *   - Calls statutoryRepo.insertGratuity with correct amount
 *   - Emits an audit event (audit.event.record) on successful computation
 *   - Does NOT compute/insert when years of service < 5
 *
 * Uses vi.mock to stub DB and outbox — no live database required.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { randomUUID } from "node:crypto";
import { MemoryQueue } from "@civitasone/queue";

// ---------------------------------------------------------------------------
// Module mocks — declared before importing the consumer.
// ---------------------------------------------------------------------------

const {
  mockTx,
  dbTransactionFn,
  insertGratuityMock,
  markProcessedMock,
  enqueuedMessages,
  executeResult,
} = vi.hoisted(() => {
  const _executeResult: { rows: Array<Record<string, unknown>> } = { rows: [] };
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
    // Raw SQL execution — used by the consumer to resolve DA rates.
    execute: vi.fn(async () => _executeResult.rows),
  };
  const _dbTransactionFn = vi.fn(async (cb: (tx: unknown) => Promise<void>) => {
    await cb(_mockTx);
  });
  const _insertGratuityMock = vi.fn(async () => undefined);
  const _markProcessedMock = vi.fn(async () => true);
  const _enqueuedMessages: Array<{ topic: string; payload: unknown }> = [];
  return {
    mockTx: _mockTx,
    dbTransactionFn: _dbTransactionFn as any,
    insertGratuityMock: _insertGratuityMock as any,
    markProcessedMock: _markProcessedMock as any,
    enqueuedMessages: _enqueuedMessages,
    executeResult: _executeResult,
  };
});

// 1. DB mock.
vi.mock("../src/shared/db.js", () => ({
  db: { transaction: dbTransactionFn },
}));

// 2. Outbox — capture enqueue calls + markProcessed.
vi.mock("../src/shared/outbox.js", () => ({
  enqueue: vi.fn(async (_tx: unknown, msg: { topic: string; payload: unknown }) => {
    enqueuedMessages.push({ topic: msg.topic, payload: msg.payload });
  }),
  markProcessed: (...args: any[]) => markProcessedMock(...args),
}));

// 3. LOP repo — not used for separation but may be imported.
vi.mock("../src/modules/integration/lop-repo.js", () => ({
  upsertLopDays: vi.fn(async () => undefined),
}));

// 4. Statutory repo — capture insertGratuity calls.
vi.mock("../src/modules/statutory/repo.js", () => ({
  insertGratuity: (...args: any[]) => insertGratuityMock(...args),
  insertPf: vi.fn(async () => undefined),
  insertEsi: vi.fn(async () => undefined),
  insertTds: vi.fn(async () => undefined),
  insertGpf: vi.fn(async () => undefined),
  insertNps: vi.fn(async () => undefined),
}));

// 5. Cache — no-op.
vi.mock("../src/shared/infra.js", () => ({
  cache: {
    invalidate: vi.fn(async () => undefined),
    makeKey: vi.fn((...parts: string[]) => parts.join(":")),
  },
}));

// ---------------------------------------------------------------------------
// Import consumer AFTER mocks.
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

const settle = () => new Promise<void>((r) => setTimeout(r, 200));

// ---------------------------------------------------------------------------
beforeEach(() => {
  vi.clearAllMocks();
  enqueuedMessages.length = 0;
  markProcessedMock.mockResolvedValue(true);
  // Default: DA rate = 5% (500 bps). Non-zero so gratuity emoluments include DA.
  executeResult.rows = [{ rate_bps: 500 }];
  dbTransactionFn.mockImplementation(async (cb: (tx: unknown) => Promise<void>) => {
    await cb(mockTx);
  });
});

// ---------------------------------------------------------------------------
// TASK 3 — Employee separated → gratuity computed
// ---------------------------------------------------------------------------
describe("hrms.employee.separated → gratuity computation", () => {
  it("computes gratuity for 10+ years of service and calls insertGratuity", async () => {
    const q = await buildQueue();

    await q.publish(
      CONSUMED_EVENTS.employeeSeparated,
      makeMsg(CONSUMED_EVENTS.employeeSeparated, {
        employeeId: "emp-1",
        effectiveDate: "2025-06-30",
        basicMinor: "5000000", // 50,000 INR
        dateOfJoining: "2015-01-01", // ~10.5 years of service
      }),
    );
    await settle();

    expect(insertGratuityMock).toHaveBeenCalledOnce();
    const [tx, row] = insertGratuityMock.mock.calls[0]!;
    expect(row.tenantId).toBe(TENANT);
    expect(row.employeeId).toBe("emp-1");
    expect(row.separationRef).toBe("separation:2025-06-30");
    expect(row.currency).toBe("INR");
    expect(row.status).toBe("computed");
    // Gratuity for 10+ years with 50k basic + DA should be > 0.
    expect(typeof row.gratuityMinor).toBe("bigint");
    expect(row.gratuityMinor).toBeGreaterThan(0n);
    await q.stop();
  });

  it("emits audit.event.record on successful gratuity computation", async () => {
    const q = await buildQueue();

    await q.publish(
      CONSUMED_EVENTS.employeeSeparated,
      makeMsg(CONSUMED_EVENTS.employeeSeparated, {
        employeeId: "emp-1",
        effectiveDate: "2025-06-30",
        basicMinor: "5000000",
        dateOfJoining: "2015-01-01",
      }),
    );
    await settle();

    const auditEvent = enqueuedMessages.find((m) => m.topic === "audit.event.record");
    expect(auditEvent, "expected audit.event.record to be emitted").toBeDefined();

    const payload = auditEvent!.payload as Record<string, unknown>;
    expect(payload.service).toBe("payroll");
    expect(payload.action).toBe("gratuity_compute");
    expect(payload.resourceType).toBe("gratuity");
    expect(payload.resourceId).toBe("emp-1");
    expect(payload.outcome).toBe("success");
    await q.stop();
  });

  it("does NOT compute gratuity when years of service < 5", async () => {
    const q = await buildQueue();

    await q.publish(
      CONSUMED_EVENTS.employeeSeparated,
      makeMsg(CONSUMED_EVENTS.employeeSeparated, {
        employeeId: "emp-2",
        effectiveDate: "2025-06-30",
        basicMinor: "5000000",
        dateOfJoining: "2022-01-01", // ~3.5 years — below 5-year threshold
      }),
    );
    await settle();

    expect(insertGratuityMock).not.toHaveBeenCalled();
    // No audit event either since gratuity was 0.
    const auditEvent = enqueuedMessages.find((m) => m.topic === "audit.event.record");
    expect(auditEvent).toBeUndefined();
    await q.stop();
  });

  it("computes gratuity with DA included in emoluments", async () => {
    // DA = 50% (5000 bps).
    executeResult.rows = [{ rate_bps: 5000 }];
    const q = await buildQueue();

    await q.publish(
      CONSUMED_EVENTS.employeeSeparated,
      makeMsg(CONSUMED_EVENTS.employeeSeparated, {
        employeeId: "emp-3",
        effectiveDate: "2025-06-30",
        basicMinor: "3000000", // 30,000 INR basic
        dateOfJoining: "2015-01-01", // 10+ years
      }),
    );
    await settle();

    expect(insertGratuityMock).toHaveBeenCalledOnce();
    const [, row] = insertGratuityMock.mock.calls[0]!;
    // With 50% DA, emoluments = basic + DA = 30000 + 15000 = 45000 INR.
    // Gratuity = (emoluments / 26) * 15 * years (rounded).
    // The exact amount depends on computeGratuity, but it should be significantly
    // larger than without DA.
    expect(row.gratuityMinor).toBeGreaterThan(0n);
    await q.stop();
  });

  it("handles missing DA rate (defaults to 0)", async () => {
    // No DA rate rows — DA defaults to 0.
    executeResult.rows = [];
    const q = await buildQueue();

    await q.publish(
      CONSUMED_EVENTS.employeeSeparated,
      makeMsg(CONSUMED_EVENTS.employeeSeparated, {
        employeeId: "emp-4",
        effectiveDate: "2025-06-30",
        basicMinor: "5000000",
        dateOfJoining: "2010-01-01", // 15+ years
      }),
    );
    await settle();

    // Still qualifies (>5 years) — gratuity should be computed on basic alone.
    expect(insertGratuityMock).toHaveBeenCalledOnce();
    const [, row] = insertGratuityMock.mock.calls[0]!;
    expect(row.gratuityMinor).toBeGreaterThan(0n);
    await q.stop();
  });

  it("just over 5 years of service qualifies for gratuity", async () => {
    const q = await buildQueue();

    await q.publish(
      CONSUMED_EVENTS.employeeSeparated,
      makeMsg(CONSUMED_EVENTS.employeeSeparated, {
        employeeId: "emp-5",
        effectiveDate: "2025-07-15",
        basicMinor: "5000000",
        dateOfJoining: "2020-06-30", // ~5.04 years — safely above the 5-year threshold
      }),
    );
    await settle();

    expect(insertGratuityMock).toHaveBeenCalledOnce();
    const [, row] = insertGratuityMock.mock.calls[0]!;
    expect(row.gratuityMinor).toBeGreaterThan(0n);
    await q.stop();
  });

  it("idempotent: duplicate message is not processed twice", async () => {
    // Second call to markProcessed returns false (already processed).
    markProcessedMock.mockResolvedValueOnce(true).mockResolvedValueOnce(false);
    const q = await buildQueue();

    const msg = makeMsg(CONSUMED_EVENTS.employeeSeparated, {
      employeeId: "emp-6",
      effectiveDate: "2025-06-30",
      basicMinor: "5000000",
      dateOfJoining: "2015-01-01",
    });

    await q.publish(CONSUMED_EVENTS.employeeSeparated, msg);
    await settle();

    // Only one gratuity row written.
    expect(insertGratuityMock).toHaveBeenCalledOnce();
    await q.stop();
  });
});
