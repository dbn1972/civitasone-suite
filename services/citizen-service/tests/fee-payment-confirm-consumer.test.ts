/**
 * FN-14 — online payment confirm → receipt + citizen.receipt.issued (GL hook).
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
}

const {
  dbTransactionFn,
  enqueueMock,
  markProcessedMock,
  findPaymentByIdTxMock,
  updatePaymentMock,
  nextReceiptSeqMock,
  findScheduleByIdTxMock,
  findPublishedByServiceIdTxMock,
  invalidateMock,
} = vi.hoisted(() => {
  const _tx = {};
  return {
    dbTransactionFn: vi.fn(async (cb: (tx: unknown) => Promise<void>) => { await cb(_tx); }),
    enqueueMock: vi.fn(async () => undefined),
    markProcessedMock: vi.fn(async () => true),
    findPaymentByIdTxMock: vi.fn(),
    updatePaymentMock: vi.fn(async () => undefined),
    nextReceiptSeqMock: vi.fn(async () => 7),
    findScheduleByIdTxMock: vi.fn(),
    findPublishedByServiceIdTxMock: vi.fn(),
    invalidateMock: vi.fn(async () => undefined),
  };
});

vi.mock("../src/shared/db.js", () => ({ db: { transaction: dbTransactionFn } }));
vi.mock("../src/shared/outbox.js", () => ({
  enqueue: (...args: unknown[]) => enqueueMock(...args),
  markProcessed: (...args: unknown[]) => markProcessedMock(...args),
}));
vi.mock("../src/shared/infra.js", () => ({
  cache: {
    invalidate: (...args: unknown[]) => invalidateMock(...args),
    makeKey: (...parts: string[]) => parts.join(":"),
  },
}));
vi.mock("../src/shared/tenant-queue.js", () => ({
  tenantScoped: (q: unknown) => q,
}));
vi.mock("../src/modules/fee-payment/repo.js", () => ({
  findPaymentByIdTx: (...args: unknown[]) => findPaymentByIdTxMock(...args),
  updatePayment: (...args: unknown[]) => updatePaymentMock(...args),
  nextReceiptSeq: (...args: unknown[]) => nextReceiptSeqMock(...args),
  findScheduleByIdTx: (...args: unknown[]) => findScheduleByIdTxMock(...args),
  findActiveScheduleForService: vi.fn(),
  insertSchedule: vi.fn(),
  insertPayment: vi.fn(),
  insertRefund: vi.fn(),
  findRefundByIdTx: vi.fn(),
  updateRefund: vi.fn(),
  listRefundsByPayment: vi.fn(),
}));
vi.mock("../src/modules/catalogue/repo.js", () => ({
  findPublishedByServiceIdTx: (...args: unknown[]) => findPublishedByServiceIdTxMock(...args),
}));

import { registerFeePaymentConsumers } from "../src/modules/fee-payment/consumer.js";
import { COMMANDS } from "../src/topics.js";

const TENANT = "10000000-aaaa-4000-8000-000000000001";
const ACTOR = "20000000-bbbb-4000-8000-000000000001";
const PAYMENT_ID = "30000000-cccc-4000-8000-000000000001";
const APP_ID = "40000000-dddd-4000-8000-000000000001";
const SCHEDULE_ID = "50000000-eeee-4000-8000-000000000001";
const SERVICE_ID = "60000000-ffff-4000-8000-000000000001";

describe("FN-14 fee-payment confirm consumer", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    markProcessedMock.mockResolvedValue(true);
    findPaymentByIdTxMock.mockResolvedValue({
      id: PAYMENT_ID,
      tenantId: TENANT,
      applicationId: APP_ID,
      scheduleId: SCHEDULE_ID,
      amount: 50000,
      currency: "INR",
      status: "pending",
      gatewayRef: null,
    });
    findScheduleByIdTxMock.mockResolvedValue({
      id: SCHEDULE_ID,
      serviceId: SERVICE_ID,
      baseAmount: 50000,
      currency: "INR",
      exemptions: [],
    });
    findPublishedByServiceIdTxMock.mockResolvedValue({
      hoaCode: "4201",
      serviceKey: "trade-license",
    });
  });

  it("sandbox confirm marks paid, issues receipt, emits citizen.receipt.issued with HOA", async () => {
    const q = new TestMemoryQueue();
    registerFeePaymentConsumers(q as never);

    await q.publish(COMMANDS.paymentConfirm, {
      messageId: randomUUID(),
      type: COMMANDS.paymentConfirm,
      tenantId: TENANT,
      actorId: ACTOR,
      correlationId: randomUUID(),
      payload: { paymentId: PAYMENT_ID, tenantId: TENANT, mode: "sandbox" },
    });

    expect(updatePaymentMock).toHaveBeenCalledWith(
      expect.anything(),
      PAYMENT_ID,
      TENANT,
      expect.objectContaining({
        status: "paid",
        reconciliationStatus: "sandbox",
        receiptNo: expect.stringMatching(/^RCT-\d{4}-00000007$/),
      }),
    );

    const receiptEvt = enqueueMock.mock.calls.find(
      ([, msg]: [unknown, { topic: string }]) => msg.topic === "citizen.receipt.issued",
    );
    expect(receiptEvt).toBeTruthy();
    expect(receiptEvt![1].payload).toMatchObject({
      id: PAYMENT_ID,
      applicationId: APP_ID,
      amountMinor: "50000",
      hoaCode: "4201",
      serviceKey: "trade-license",
      captureMode: "sandbox",
    });
  });

  it("skips when payment is not pending", async () => {
    findPaymentByIdTxMock.mockResolvedValueOnce({
      id: PAYMENT_ID, tenantId: TENANT, applicationId: APP_ID, scheduleId: SCHEDULE_ID,
      amount: 50000, currency: "INR", status: "paid", gatewayRef: null,
    });
    const q = new TestMemoryQueue();
    registerFeePaymentConsumers(q as never);

    await q.publish(COMMANDS.paymentConfirm, {
      messageId: randomUUID(),
      type: COMMANDS.paymentConfirm,
      tenantId: TENANT,
      actorId: ACTOR,
      correlationId: randomUUID(),
      payload: { paymentId: PAYMENT_ID, tenantId: TENANT, mode: "sandbox" },
    });

    expect(updatePaymentMock).not.toHaveBeenCalled();
    expect(enqueueMock).not.toHaveBeenCalled();
  });
});
