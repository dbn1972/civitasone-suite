/**
 * FN-14 — citizen.receipt.issued → GL journal consumer tests.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { randomUUID } from "node:crypto";

type Handler = (msg: unknown) => Promise<void>;
class TestMemoryQueue {
  private handlers = new Map<string, Handler[]>();
  async publish(topic: string, input: Record<string, unknown>): Promise<string> {
    const msg = {
      messageId: (input.messageId as string) ?? randomUUID(),
      type: (input.type as string) ?? topic,
      tenantId: input.tenantId as string,
      actorId: input.actorId as string,
      correlationId: input.correlationId as string,
      timestamp: new Date().toISOString(),
      schemaVersion: "1.0",
      payload: input.payload,
    };
    for (const h of this.handlers.get(topic) ?? []) await h(msg);
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

const {
  dbTransactionFn,
  enqueueMock,
  markProcessedMock,
  findHeadByCodeTxMock,
  enqueueSpineJournalMock,
} = vi.hoisted(() => {
  const _mockTx = {};
  const _dbTransactionFn = vi.fn(async (cb: (tx: unknown) => Promise<void>) => { await cb(_mockTx); });
  const _enqueueMock = vi.fn(async () => undefined);
  const _markProcessedMock = vi.fn(async () => true);
  const _findHeadByCodeTxMock = vi.fn(async (_tx: unknown, _tenantId: string, code: string) => ({
    id: `head-${code}`, code, name: `Head ${code}`,
  }));
  const _enqueueSpineJournalMock = vi.fn(async () => "journal-id");
  return {
    dbTransactionFn: _dbTransactionFn,
    enqueueMock: _enqueueMock,
    markProcessedMock: _markProcessedMock,
    findHeadByCodeTxMock: _findHeadByCodeTxMock,
    enqueueSpineJournalMock: _enqueueSpineJournalMock,
  };
});

vi.mock("../src/shared/db.js", () => ({ db: { transaction: dbTransactionFn } }));
vi.mock("../src/shared/outbox.js", () => ({
  enqueue: (...args: unknown[]) => enqueueMock(...args),
  markProcessed: (...args: unknown[]) => markProcessedMock(...args),
}));
vi.mock("../src/shared/infra.js", () => ({
  cache: { invalidateResource: vi.fn(async () => undefined) },
}));
vi.mock("../src/modules/budget/repo.js", () => ({
  findHeadByCodeTx: (...args: unknown[]) => findHeadByCodeTxMock(...args),
}));
vi.mock("../src/modules/gl/spine.js", () => ({
  enqueueSpineJournal: (...args: unknown[]) => enqueueSpineJournalMock(...args),
}));

import { registerRevenueGlConsumers } from "../src/modules/revenue-gl/consumer.js";
import { CONSUMED_EVENTS } from "../src/topics.js";

const TENANT = "10000000-aaaa-4000-8000-000000000001";
const ACTOR = "20000000-bbbb-4000-8000-000000000001";

function makeMsg(payload: Record<string, unknown>) {
  return {
    messageId: randomUUID(),
    type: CONSUMED_EVENTS.citizenReceiptIssued,
    tenantId: TENANT,
    actorId: ACTOR,
    correlationId: randomUUID(),
    schemaVersion: "1.0",
    payload,
  };
}

describe("revenue-gl consumer — citizen.receipt.issued", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    markProcessedMock.mockResolvedValue(true);
  });

  it("enqueues a balanced spine journal for a fee receipt", async () => {
    const q = new TestMemoryQueue();
    registerRevenueGlConsumers(q as never);

    const paymentId = randomUUID();
    await q.publish(CONSUMED_EVENTS.citizenReceiptIssued, makeMsg({
      id: paymentId,
      applicationId: randomUUID(),
      receiptNo: "RCT-2026-00000001",
      amountMinor: "50000",
      hoaCode: "4201",
      serviceKey: "trade-license",
    }));

    expect(enqueueSpineJournalMock).toHaveBeenCalledOnce();
    const call = enqueueSpineJournalMock.mock.calls[0]?.[1] as {
      sourceKey: string;
      type: string;
      lines: Array<{ debitMinor: bigint; creditMinor: bigint }>;
    };
    expect(call.sourceKey).toBe(`citizen_receipt:${paymentId}`);
    expect(call.type).toBe("citizen_receipt");
    const dr = call.lines.reduce((s, l) => s + BigInt(l.debitMinor), 0n);
    const cr = call.lines.reduce((s, l) => s + BigInt(l.creditMinor), 0n);
    expect(dr).toBe(50000n);
    expect(cr).toBe(50000n);
  });

  it("emits gl.rejected when revenue head code is unknown", async () => {
    findHeadByCodeTxMock.mockImplementation(async (_tx, _tenant, code) => {
      if (code === "4201") return { id: "head-4201", code: "4201" };
      if (code === "1100") return { id: "head-1100", code: "1100" };
      return null;
    });

    const q = new TestMemoryQueue();
    registerRevenueGlConsumers(q as never);

    await q.publish(CONSUMED_EVENTS.citizenReceiptIssued, makeMsg({
      id: randomUUID(),
      applicationId: randomUUID(),
      receiptNo: "RCT-2026-00000002",
      amountMinor: "100",
      hoaCode: "9999",
    }));

    const rejected = enqueueMock.mock.calls.find(
      ([, msg]: [unknown, { topic: string }]) => msg.topic === "finance.gl.rejected",
    );
    expect(rejected).toBeTruthy();
    expect(enqueueSpineJournalMock).not.toHaveBeenCalled();
  });

  it("skips zero-amount receipts", async () => {
    const q = new TestMemoryQueue();
    registerRevenueGlConsumers(q as never);

    await q.publish(CONSUMED_EVENTS.citizenReceiptIssued, makeMsg({
      id: randomUUID(),
      applicationId: randomUUID(),
      receiptNo: "RCT-2026-00000003",
      amountMinor: "0",
    }));

    expect(enqueueSpineJournalMock).not.toHaveBeenCalled();
  });
});
