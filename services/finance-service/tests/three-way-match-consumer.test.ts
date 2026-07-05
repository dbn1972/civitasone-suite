/**
 * Unit tests for the three-way match consumer in payments module.
 *
 * Verifies: procurement.grn.accepted → draft bill created → three_way_match.passed/failed emitted
 *
 * Covers:
 * - Happy path: GRN accepted → draft bill created → three_way_match.passed emitted
 * - Mismatch path: PO/GRN amounts differ > 5% → three_way_match.failed emitted with reason
 * - Idempotency: duplicate messageId is skipped (markProcessed returns false)
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { randomUUID } from "node:crypto";

// ---------------------------------------------------------------------------
// Lightweight in-process MemoryQueue
// ---------------------------------------------------------------------------
type Handler = (msg: any) => Promise<void>;
class TestMemoryQueue {
  private handlers = new Map<string, Handler[]>();
  async publish(topic: string, input: any): Promise<string> {
    const msg = {
      messageId: input.messageId ?? randomUUID(),
      type: input.type ?? topic,
      tenantId: input.tenantId,
      actorId: input.actorId,
      correlationId: input.correlationId,
      timestamp: new Date().toISOString(),
      schemaVersion: input.schemaVersion ?? "1.0",
      payload: input.payload,
    };
    const handlers = this.handlers.get(topic) ?? [];
    setTimeout(() => { for (const h of handlers) void h(msg); }, 0);
    return msg.messageId;
  }
  subscribe(topic: string, handler: Handler): void {
    const list = this.handlers.get(topic) ?? [];
    list.push(handler);
    this.handlers.set(topic, list);
  }
  async start(): Promise<void> {}
  async stop(): Promise<void> { this.handlers.clear(); }
}

// ---------------------------------------------------------------------------
// Module mocks
// ---------------------------------------------------------------------------
const {
  mockTx,
  dbTransactionFn,
  enqueueMock,
  markProcessedMock,
  insertBillMock,
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
  const _enqueueMock = vi.fn(async () => undefined);
  const _markProcessedMock = vi.fn(async () => true);
  const _insertBillMock = vi.fn(async () => undefined);
  return {
    mockTx: _mockTx,
    dbTransactionFn: _dbTransactionFn as any,
    enqueueMock: _enqueueMock as any,
    markProcessedMock: _markProcessedMock as any,
    insertBillMock: _insertBillMock as any,
  };
});

vi.mock("../src/shared/db.js", () => ({
  db: { transaction: dbTransactionFn },
}));

vi.mock("../src/shared/outbox.js", () => ({
  enqueue: (...args: any[]) => enqueueMock(...args),
  markProcessed: (...args: any[]) => markProcessedMock(...args),
}));

vi.mock("../src/shared/infra.js", () => ({
  cache: {
    invalidate: vi.fn(async () => undefined),
    invalidateResource: vi.fn(async () => undefined),
    makeKey: vi.fn((...parts: string[]) => parts.join(":")),
    put: vi.fn(async () => undefined),
  },
}));

vi.mock("../src/modules/payments/repo.js", () => ({
  insertBill: (...args: any[]) => insertBillMock(...args),
  findBillByIdTx: vi.fn(async () => null),
  findPaymentByIdTx: vi.fn(async () => null),
  updateBill: vi.fn(async () => undefined),
  insertPayment: vi.fn(async () => undefined),
  updatePayment: vi.fn(async () => undefined),
  insertAdvance: vi.fn(async () => undefined),
  insertUC: vi.fn(async () => undefined),
  findAdvanceByIdTx: vi.fn(async () => null),
  findGrnMatch: vi.fn(async () => null),
  upsertGrnMatch: vi.fn(async () => undefined),
}));

vi.mock("../src/modules/budget/repo.js", () => ({
  findHeadByCodeTx: vi.fn(async () => ({ id: "head-001", code: "2050", name: "AP Control" })),
  findHeadByIdTx: vi.fn(async () => ({ id: "head-001", code: "2050", name: "AP Control", tenantId: "10000000-aaaa-4000-8000-000000000001" })),
  findSanctionByIdTx: vi.fn(async () => null),
  incrementSanctionUtilisedGuarded: vi.fn(async () => true),
}));

vi.mock("../src/modules/budget/allocation-repo.js", () => ({
  findAllocationTx: vi.fn(async () => null),
  addCommittedGuarded: vi.fn(async () => true),
  settleCommittedToActualGuarded: vi.fn(async () => true),
}));

vi.mock("../src/modules/masters/repo.js", () => ({
  ddoExists: vi.fn(async () => true),
  paoExists: vi.fn(async () => true),
}));

vi.mock("../src/modules/pfms/repo.js", () => ({
  getTenantConfig: vi.fn(async () => ({ agencyCode: "AG001", defaultDdo: "DDO001" })),
}));

vi.mock("../src/modules/period-close/routes.js", () => ({
  getPeriodStatus: vi.fn(async () => "open"),
}));

vi.mock("../src/modules/hoa/domain.js", () => ({
  assertValidHoAWithMaster: vi.fn(async () => undefined),
}));

vi.mock("../src/modules/hoa/voucher.js", () => ({
  fyFromDate: vi.fn(() => "2025-26"),
  nextDocNo: vi.fn(async () => ({ docNo: "BILL-001" })),
  nextVoucherNo: vi.fn(async () => ({ voucherNo: "JV/001" })),
}));

vi.mock("../src/shared/pfms.js", () => ({
  assertValidDdoCode: vi.fn(() => undefined),
}));

vi.mock("../src/modules/gl/spine.js", () => ({
  enqueueSpineJournal: vi.fn(async () => undefined),
}));

vi.mock("../src/shared/cashbook.js", () => ({
  postCashBook: vi.fn(async () => undefined),
}));

// ---------------------------------------------------------------------------
// Import the consumer AFTER mocks
// ---------------------------------------------------------------------------
import { registerPaymentsConsumers } from "../src/modules/payments/consumer.js";
import { CONSUMED_EVENTS } from "../src/topics.js";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------
const TENANT = "10000000-aaaa-4000-8000-000000000001";
const ACTOR = "20000000-bbbb-4000-8000-000000000001";

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

async function buildQueue(): Promise<TestMemoryQueue> {
  const q = new TestMemoryQueue();
  registerPaymentsConsumers(q as any);
  await q.start();
  return q;
}

const settle = () => new Promise<void>((r) => setTimeout(r, 150));

// ---------------------------------------------------------------------------
beforeEach(() => {
  vi.clearAllMocks();
  markProcessedMock.mockResolvedValue(true);
  dbTransactionFn.mockImplementation(async (cb: (tx: unknown) => Promise<void>) => {
    await cb(mockTx);
  });
});

// ---------------------------------------------------------------------------
// Three-Way Match Consumer Tests
// ---------------------------------------------------------------------------
describe("procurement.grn.accepted → three-way match validation", () => {
  const BASE_PAYLOAD = {
    poId: "po-001",
    grnId: "grn-001",
    vendorId: "vendor-001",
    totalMinor: 5000000,
    tenantId: TENANT,
  };

  describe("happy path: amounts match → three_way_match.passed emitted", () => {
    it("creates a draft bill and emits three_way_match.passed when PO = GRN amount", async () => {
      const q = await buildQueue();

      await q.publish(
        CONSUMED_EVENTS.grnAccepted,
        makeMsg(CONSUMED_EVENTS.grnAccepted, {
          ...BASE_PAYLOAD,
          poAmountMinor: 5000000,
        }),
      );
      await settle();

      // Draft bill should be inserted
      expect(insertBillMock).toHaveBeenCalled();
      const billArgs = insertBillMock.mock.calls[0];
      expect(billArgs[1].status).toBe("draft");
      expect(billArgs[1].poRef).toContain("po-001");
      expect(billArgs[1].grnRef).toContain("grn-001");
      expect(billArgs[1].vendorId).toBe("vendor-001");

      // three_way_match.passed event should be emitted
      const passedCall = enqueueMock.mock.calls.find(
        ([_tx, msg]: [unknown, { topic: string }]) => msg.topic === "procurement.three_way_match.passed",
      );
      expect(passedCall).toBeDefined();
      const payload = passedCall![1].payload;
      expect(payload.poId).toBe("po-001");
      expect(payload.grnId).toBe("grn-001");
      expect(payload.vendorId).toBe("vendor-001");
      expect(payload.poAmountMinor).toBe("5000000");
      expect(payload.grnAmountMinor).toBe("5000000");
      expect(payload.variancePct).toBe(0);

      await q.stop();
    });

    it("passes when GRN is within 5% tolerance of PO amount", async () => {
      const q = await buildQueue();

      // GRN is 4% over PO — should still pass (tolerance is 5%)
      await q.publish(
        CONSUMED_EVENTS.grnAccepted,
        makeMsg(CONSUMED_EVENTS.grnAccepted, {
          ...BASE_PAYLOAD,
          poAmountMinor: 5000000,
          totalMinor: 5200000, // 4% over
        }),
      );
      await settle();

      const passedCall = enqueueMock.mock.calls.find(
        ([_tx, msg]: [unknown, { topic: string }]) => msg.topic === "procurement.three_way_match.passed",
      );
      expect(passedCall).toBeDefined();
      expect(passedCall![1].payload.variancePct).toBeCloseTo(4, 0);

      const failedCall = enqueueMock.mock.calls.find(
        ([_tx, msg]: [unknown, { topic: string }]) => msg.topic === "procurement.three_way_match.failed",
      );
      expect(failedCall).toBeUndefined();

      await q.stop();
    });
  });

  describe("mismatch path: variance > 5% → three_way_match.failed emitted", () => {
    it("emits three_way_match.failed when GRN exceeds PO by more than 5%", async () => {
      const q = await buildQueue();

      // GRN is 10% over PO — should fail
      await q.publish(
        CONSUMED_EVENTS.grnAccepted,
        makeMsg(CONSUMED_EVENTS.grnAccepted, {
          ...BASE_PAYLOAD,
          poAmountMinor: 5000000,
          totalMinor: 5500000, // 10% over
        }),
      );
      await settle();

      const failedCall = enqueueMock.mock.calls.find(
        ([_tx, msg]: [unknown, { topic: string }]) => msg.topic === "procurement.three_way_match.failed",
      );
      expect(failedCall).toBeDefined();
      const payload = failedCall![1].payload;
      expect(payload.poId).toBe("po-001");
      expect(payload.grnId).toBe("grn-001");
      expect(payload.reason).toContain("variance");
      expect(payload.reason).toContain("5%");
      expect(payload.variancePct).toBeGreaterThan(5);

      const passedCall = enqueueMock.mock.calls.find(
        ([_tx, msg]: [unknown, { topic: string }]) => msg.topic === "procurement.three_way_match.passed",
      );
      expect(passedCall).toBeUndefined();

      await q.stop();
    });

    it("emits three_way_match.failed when GRN is under PO by more than 5%", async () => {
      const q = await buildQueue();

      // GRN is 20% under PO — should fail (underbilling beyond tolerance)
      await q.publish(
        CONSUMED_EVENTS.grnAccepted,
        makeMsg(CONSUMED_EVENTS.grnAccepted, {
          ...BASE_PAYLOAD,
          poAmountMinor: 5000000,
          totalMinor: 3500000, // 30% under
        }),
      );
      await settle();

      const failedCall = enqueueMock.mock.calls.find(
        ([_tx, msg]: [unknown, { topic: string }]) => msg.topic === "procurement.three_way_match.failed",
      );
      expect(failedCall).toBeDefined();
      expect(failedCall![1].payload.variancePct).toBeGreaterThan(5);

      await q.stop();
    });

    it("includes reason with variance details", async () => {
      const q = await buildQueue();

      await q.publish(
        CONSUMED_EVENTS.grnAccepted,
        makeMsg(CONSUMED_EVENTS.grnAccepted, {
          ...BASE_PAYLOAD,
          poAmountMinor: 1000000,
          totalMinor: 1200000, // 20% over
        }),
      );
      await settle();

      const failedCall = enqueueMock.mock.calls.find(
        ([_tx, msg]: [unknown, { topic: string }]) => msg.topic === "procurement.three_way_match.failed",
      );
      expect(failedCall).toBeDefined();
      expect(failedCall![1].payload.reason).toMatch(/exceeds.*5%.*tolerance/);

      await q.stop();
    });
  });

  describe("idempotency: duplicate messageId is skipped", () => {
    it("skips processing when markProcessed returns false", async () => {
      markProcessedMock.mockResolvedValue(false);
      const q = await buildQueue();

      await q.publish(
        CONSUMED_EVENTS.grnAccepted,
        makeMsg(CONSUMED_EVENTS.grnAccepted, BASE_PAYLOAD),
      );
      await settle();

      // No bill should be inserted
      expect(insertBillMock).not.toHaveBeenCalled();

      // No match event should be emitted
      const passedCall = enqueueMock.mock.calls.find(
        ([_tx, msg]: [unknown, { topic: string }]) => msg.topic === "procurement.three_way_match.passed",
      );
      const failedCall = enqueueMock.mock.calls.find(
        ([_tx, msg]: [unknown, { topic: string }]) => msg.topic === "procurement.three_way_match.failed",
      );
      expect(passedCall).toBeUndefined();
      expect(failedCall).toBeUndefined();

      await q.stop();
    });
  });

  describe("edge cases", () => {
    it("defaults poAmountMinor to grnTotalMinor when not provided", async () => {
      const q = await buildQueue();

      // No poAmountMinor in payload — defaults to grnTotalMinor → 0% variance → passes
      await q.publish(
        CONSUMED_EVENTS.grnAccepted,
        makeMsg(CONSUMED_EVENTS.grnAccepted, {
          poId: "po-002",
          grnId: "grn-002",
          vendorId: "vendor-002",
          totalMinor: 3000000,
          tenantId: TENANT,
        }),
      );
      await settle();

      const passedCall = enqueueMock.mock.calls.find(
        ([_tx, msg]: [unknown, { topic: string }]) => msg.topic === "procurement.three_way_match.passed",
      );
      expect(passedCall).toBeDefined();
      expect(passedCall![1].payload.variancePct).toBe(0);

      await q.stop();
    });

    it("invalidates bills cache after processing", async () => {
      const { cache } = await import("../src/shared/infra.js");
      const q = await buildQueue();

      await q.publish(
        CONSUMED_EVENTS.grnAccepted,
        makeMsg(CONSUMED_EVENTS.grnAccepted, BASE_PAYLOAD),
      );
      await settle();

      expect(cache.invalidateResource).toHaveBeenCalledWith(TENANT, "bills");

      await q.stop();
    });
  });
});
