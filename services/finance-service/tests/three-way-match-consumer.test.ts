/**
 * Unit tests for the procurement.grn.accepted consumer.
 *
 * NOTE: this file originally targeted a duplicate grnAccepted subscriber that
 * lived in payments/consumer.ts. Commit bcf0980c ("Consumer-H3: remove
 * duplicate grnAccepted from payments consumer; merge 3-way-match advisory
 * into integrations") deleted that duplicate -- two consumers independently
 * subscribed to the same procurement.grn.accepted topic would each draft a
 * bill, double-posting the same GRN -- and consolidated the one remaining
 * handler into integrations/consumer.ts's registerIntegrationConsumers().
 * This test file was never updated to follow that move, so every case here
 * was silently exercising dead code: registerPaymentsConsumers() no longer
 * subscribes to procurement.grn.accepted at all (confirmed empirically by
 * logging TestMemoryQueue's handler map after registration -- it contains
 * only the finance.bill.* / finance.payment.* / finance.advance.* command
 * topics, never procurement.grn.accepted). Retargeted onto the real, current
 * handler in integrations/consumer.ts.
 *
 * Behavioral differences from the original (removed) handler, preserved
 * faithfully here rather than papered over -- see PLATFORM notes below:
 *  - The current handler does NOT insert the draft bill itself; it enqueues
 *    COMMANDS.billCreate and leaves the actual insert to payments/consumer.ts's
 *    billCreate subscriber (already covered against a real DB by
 *    tests/finance.test.ts's "CQRS wiring" case). This test asserts on the
 *    billCreate command payload rather than a direct repo.insertBill call.
 *  - The current handler reads payload.poRef (not payload.poId), and only
 *    runs the three-way-match advisory when BOTH poAmountMinor AND
 *    grnAmountMinor are present on the message -- if either is missing, no
 *    procurement.three_way_match.* event is emitted at all. The old handler
 *    defaulted a missing poAmountMinor to the GRN total, which always
 *    synthesized a "passed" event. See the "edge cases" block below. Flagged
 *    in the PR description as a real (if currently inert -- no consumer in
 *    this repo subscribes to procurement.three_way_match.passed/failed
 *    anywhere) behavioral regression worth a product decision, not silently
 *    fixed here.
 *  - The current handler never calls cache.invalidateResource(tenant,
 *    "bills") -- neither here nor in the downstream billCreate consumer
 *    (which only invalidates the single-bill cache key, not the bills list).
 *    The old "invalidates bills cache after processing" case tested
 *    functionality that no longer exists anywhere in this flow, so it has
 *    been removed rather than faked. Also flagged in the PR description.
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
  subscribe(topic: string, handler: Handler, _opts?: unknown): void {
    const list = this.handlers.get(topic) ?? [];
    list.push(handler);
    this.handlers.set(topic, list);
  }
  async start(): Promise<void> {}
  async stop(): Promise<void> { this.handlers.clear(); }
}

// ---------------------------------------------------------------------------
// Module mocks -- only what integrations/consumer.ts's grnAccepted handler
// actually touches: db.transaction, outbox enqueue/markProcessed, and
// paymentsRepo.upsertGrnMatch (the AP three-way-match read-model upsert).
// ---------------------------------------------------------------------------
const {
  mockTx,
  dbTransactionFn,
  enqueueMock,
  markProcessedMock,
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
  return {
    mockTx: _mockTx,
    dbTransactionFn: _dbTransactionFn as any,
    enqueueMock: _enqueueMock as any,
    markProcessedMock: _markProcessedMock as any,
  };
});

vi.mock("../src/shared/db.js", () => ({
  db: { transaction: dbTransactionFn },
}));

vi.mock("../src/shared/outbox.js", () => ({
  enqueue: (...args: any[]) => enqueueMock(...args),
  markProcessed: (...args: any[]) => markProcessedMock(...args),
}));

vi.mock("../src/modules/payments/repo.js", () => ({
  upsertGrnMatch: vi.fn(async () => undefined),
}));

vi.mock("../src/modules/pfms/repo.js", () => ({
  getTenantConfig: vi.fn(async () => ({ agencyCode: "AG001", defaultDdo: "DDO001" })),
  insertPfmsBatch: vi.fn(async () => undefined),
}));

// ---------------------------------------------------------------------------
// Import the consumer AFTER mocks
// ---------------------------------------------------------------------------
import { registerIntegrationConsumers } from "../src/modules/integrations/consumer.js";
import { CONSUMED_EVENTS, COMMANDS } from "../src/topics.js";

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
  registerIntegrationConsumers(q as any);
  await q.start();
  return q;
}

const settle = () => new Promise<void>((r) => setTimeout(r, 150));

function billCreateCall() {
  return enqueueMock.mock.calls.find(
    ([_tx, msg]: [unknown, { topic: string }]) => msg.topic === COMMANDS.billCreate,
  );
}
function passedCall() {
  return enqueueMock.mock.calls.find(
    ([_tx, msg]: [unknown, { topic: string }]) => msg.topic === "procurement.three_way_match.passed",
  );
}
function failedCall() {
  return enqueueMock.mock.calls.find(
    ([_tx, msg]: [unknown, { topic: string }]) => msg.topic === "procurement.three_way_match.failed",
  );
}

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
    poRef: "po-001",
    grnId: "grn-001",
    vendorId: "vendor-001",
    grnAmountMinor: 5000000,
    tenantId: TENANT,
  };

  describe("happy path: amounts match → three_way_match.passed emitted", () => {
    it("enqueues a billCreate command and emits three_way_match.passed when PO = GRN amount", async () => {
      const q = await buildQueue();

      await q.publish(
        CONSUMED_EVENTS.grnAccepted,
        makeMsg(CONSUMED_EVENTS.grnAccepted, {
          ...BASE_PAYLOAD,
          poAmountMinor: 5000000,
        }),
      );
      await settle();

      // billCreate command should be enqueued for the downstream bill consumer
      // (see tests/finance.test.ts for real-DB coverage of what that consumer does).
      const bc = billCreateCall();
      expect(bc).toBeDefined();
      const billPayload = bc![1].payload;
      expect(billPayload.poRef).toContain("po-001");
      expect(billPayload.grnRef).toContain("grn-001");
      expect(billPayload.vendorId).toBe("vendor-001");

      // three_way_match.passed event should be emitted
      const pc = passedCall();
      expect(pc).toBeDefined();
      const payload = pc![1].payload;
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
          grnAmountMinor: 5200000, // 4% over
        }),
      );
      await settle();

      const pc = passedCall();
      expect(pc).toBeDefined();
      expect(pc![1].payload.variancePct).toBeCloseTo(4, 0);
      expect(failedCall()).toBeUndefined();

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
          grnAmountMinor: 5500000, // 10% over
        }),
      );
      await settle();

      const fc = failedCall();
      expect(fc).toBeDefined();
      const payload = fc![1].payload;
      expect(payload.grnId).toBe("grn-001");
      expect(payload.reason).toContain("variance");
      expect(payload.reason).toContain("5%");
      expect(payload.variancePct).toBeGreaterThan(5);

      expect(passedCall()).toBeUndefined();

      await q.stop();
    });

    it("emits three_way_match.failed when GRN is under PO by more than 5%", async () => {
      const q = await buildQueue();

      // GRN is 30% under PO — should fail (underbilling beyond tolerance)
      await q.publish(
        CONSUMED_EVENTS.grnAccepted,
        makeMsg(CONSUMED_EVENTS.grnAccepted, {
          ...BASE_PAYLOAD,
          poAmountMinor: 5000000,
          grnAmountMinor: 3500000, // 30% under
        }),
      );
      await settle();

      const fc = failedCall();
      expect(fc).toBeDefined();
      expect(fc![1].payload.variancePct).toBeGreaterThan(5);

      await q.stop();
    });

    it("includes reason with variance details", async () => {
      const q = await buildQueue();

      await q.publish(
        CONSUMED_EVENTS.grnAccepted,
        makeMsg(CONSUMED_EVENTS.grnAccepted, {
          ...BASE_PAYLOAD,
          poAmountMinor: 1000000,
          grnAmountMinor: 1200000, // 20% over
        }),
      );
      await settle();

      const fc = failedCall();
      expect(fc).toBeDefined();
      expect(fc![1].payload.reason).toMatch(/exceeds.*5%.*tolerance/);

      await q.stop();
    });
  });

  describe("idempotency: duplicate messageId is skipped", () => {
    it("skips processing when markProcessed returns false", async () => {
      markProcessedMock.mockResolvedValue(false);
      const q = await buildQueue();

      await q.publish(
        CONSUMED_EVENTS.grnAccepted,
        makeMsg(CONSUMED_EVENTS.grnAccepted, { ...BASE_PAYLOAD, poAmountMinor: 5000000 }),
      );
      await settle();

      // No billCreate command should be enqueued
      expect(billCreateCall()).toBeUndefined();

      // No match event should be emitted
      expect(passedCall()).toBeUndefined();
      expect(failedCall()).toBeUndefined();

      await q.stop();
    });
  });

  describe("edge cases", () => {
    it("skips the three-way-match advisory when poAmountMinor is not provided (current handler requires both legs)", async () => {
      const q = await buildQueue();

      // No poAmountMinor in payload. Unlike the removed payments/consumer.ts
      // handler this test originally targeted -- which defaulted a missing PO
      // amount to the GRN total and always emitted "passed" -- the current
      // integrations/consumer.ts handler only runs the three-way-match
      // advisory when BOTH poAmountMinor and grnAmountMinor are present on
      // the message (see file header). The bill is still drafted via
      // billCreate either way.
      await q.publish(
        CONSUMED_EVENTS.grnAccepted,
        makeMsg(CONSUMED_EVENTS.grnAccepted, {
          poRef: "po-002",
          grnId: "grn-002",
          vendorId: "vendor-002",
          grnAmountMinor: 3000000,
          tenantId: TENANT,
        }),
      );
      await settle();

      expect(billCreateCall()).toBeDefined();
      expect(passedCall()).toBeUndefined();
      expect(failedCall()).toBeUndefined();

      await q.stop();
    });
  });
});
