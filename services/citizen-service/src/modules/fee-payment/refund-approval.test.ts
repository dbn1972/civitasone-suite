/**
 * V4-G-09 -- an approved citizen refund must reach finance (citizen.refund.approved -> GL reversal),
 * and a partial refund must not flip the whole payment to "refunded" or lock the remaining balance.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { randomUUID } from "node:crypto";

type Handler = (msg: unknown) => Promise<void>;
class TestMemoryQueue {
  handlers = new Map<string, Handler[]>();
  async publish(topic: string, input: Record<string, unknown>): Promise<void> {
    for (const h of this.handlers.get(topic) ?? []) await h({ messageId: randomUUID(), ...input });
  }
  subscribe(topic: string, handler: Handler): void {
    this.handlers.set(topic, [...(this.handlers.get(topic) ?? []), handler]);
  }
}

const m = vi.hoisted(() => ({
  queue: null as unknown,
  enqueue: vi.fn(async (..._a: unknown[]) => undefined),
  markProcessed: vi.fn(async () => true),
  findPaymentByIdTx: vi.fn(),
  findPaymentById: vi.fn(),
  updatePayment: vi.fn(async (..._a: unknown[]) => undefined),
  findRefundByIdTx: vi.fn(),
  updateRefund: vi.fn(async (..._a: unknown[]) => undefined),
  insertRefund: vi.fn(async (..._a: unknown[]) => undefined),
  listRefundsByPaymentTx: vi.fn(),
  listRefundsByPayment: vi.fn(),
  findScheduleByIdTx: vi.fn(),
  findPublishedByServiceIdTx: vi.fn(),
}));

vi.mock("../../shared/db.js", () => ({ db: { transaction: async (cb: (tx: unknown) => unknown) => cb({}) } }));
vi.mock("../../shared/outbox.js", () => ({ enqueue: m.enqueue, markProcessed: m.markProcessed }));
vi.mock("../../shared/infra.js", () => ({
  cache: { invalidate: vi.fn(async () => undefined), put: vi.fn(async () => undefined), makeKey: (...p: string[]) => p.join(":") },
  get queue() { return m.queue; },
}));
vi.mock("../../shared/tenant-queue.js", () => ({ tenantScoped: (q: unknown) => q }));
vi.mock("./repo.js", () => ({
  findPaymentByIdTx: m.findPaymentByIdTx,
  findPaymentById: m.findPaymentById,
  updatePayment: m.updatePayment,
  findRefundByIdTx: m.findRefundByIdTx,
  updateRefund: m.updateRefund,
  insertRefund: m.insertRefund,
  listRefundsByPaymentTx: m.listRefundsByPaymentTx,
  listRefundsByPayment: m.listRefundsByPayment,
  findScheduleByIdTx: m.findScheduleByIdTx,
}));
vi.mock("../catalogue/repo.js", () => ({ findPublishedByServiceIdTx: m.findPublishedByServiceIdTx }));
vi.mock("../application/repo.js", () => ({ findApplicationByIdTx: vi.fn(), findApplicationById: vi.fn() }));

import { registerFeePaymentConsumers } from "./consumer.js";
import { requestRefund } from "./commands.js";
import { COMMANDS } from "../../topics.js";

const TENANT = "10000000-aaaa-4000-8000-000000000001";
const MAKER = "20000000-bbbb-4000-8000-000000000001";
const CHECKER = "20000000-bbbb-4000-8000-000000000002";
const PAYMENT = "30000000-cccc-4000-8000-000000000001";
const REFUND = "30000000-cccc-4000-8000-000000000002";
const APP = "40000000-dddd-4000-8000-000000000001";
const SCHEDULE = "50000000-eeee-4000-8000-000000000001";
const SERVICE = "60000000-ffff-4000-8000-000000000001";

const payment = { id: PAYMENT, tenantId: TENANT, applicationId: APP, scheduleId: SCHEDULE, amount: 1000, currency: "INR", status: "paid", receiptNo: "RCT-2026-00000001" };
const refund = (amount: number, status = "requested") => ({ id: REFUND, tenantId: TENANT, paymentId: PAYMENT, amount, status, requestedBy: MAKER });
const ctx = (actorId: string) => ({ tenantId: TENANT, actorId, actorType: "user" as const, correlationId: randomUUID(), roles: ["citizen_officer"] });

function decide(q: TestMemoryQueue) {
  return q.publish(COMMANDS.refundDecide, {
    tenantId: TENANT, actorId: CHECKER, correlationId: randomUUID(),
    payload: { refundId: REFUND, tenantId: TENANT, decision: "approve" },
  });
}
const emitted = (topic: string) => m.enqueue.mock.calls.map((c) => c[1] as { topic: string; payload: Record<string, unknown> }).find((e) => e.topic === topic);

beforeEach(() => {
  vi.clearAllMocks();
  m.markProcessed.mockResolvedValue(true);
  m.findPaymentByIdTx.mockResolvedValue(payment);
  m.findPaymentById.mockResolvedValue(payment);
  m.findScheduleByIdTx.mockResolvedValue({ id: SCHEDULE, serviceId: SERVICE });
  m.findPublishedByServiceIdTx.mockResolvedValue({ hoaCode: "4201", serviceKey: "trade-licence" });
  m.listRefundsByPaymentTx.mockResolvedValue([]);
  m.listRefundsByPayment.mockResolvedValue([]);
});

describe("V4-G-09 approved refund reaches finance", () => {
  it("emits citizen.refund.approved with the amount in minor units and the revenue head", async () => {
    m.findRefundByIdTx.mockResolvedValue(refund(1000));
    m.listRefundsByPaymentTx.mockResolvedValue([refund(1000)]);
    const q = new TestMemoryQueue();
    registerFeePaymentConsumers(q as never);
    await decide(q);
    const evt = emitted("citizen.refund.approved");
    expect(evt).toBeTruthy();
    expect(evt!.payload).toMatchObject({
      id: REFUND, paymentId: PAYMENT, applicationId: APP, receiptNo: "RCT-2026-00000001",
      amountMinor: "1000", currency: "INR", hoaCode: "4201", fullyRefunded: true,
    });
  });
});

describe("V4-G-09 partial refunds", () => {
  it("a partial approval does not flip the whole payment to refunded", async () => {
    m.findRefundByIdTx.mockResolvedValue(refund(100));
    m.listRefundsByPaymentTx.mockResolvedValue([refund(100)]);
    const q = new TestMemoryQueue();
    registerFeePaymentConsumers(q as never);
    await decide(q);
    expect(m.updatePayment).not.toHaveBeenCalledWith(expect.anything(), PAYMENT, TENANT, expect.objectContaining({ status: "refunded" }));
    expect(emitted("citizen.refund.approved")!.payload).toMatchObject({ amountMinor: "100", fullyRefunded: false });
  });

  it("flips to refunded once the approved refunds add up to the payment amount", async () => {
    m.findRefundByIdTx.mockResolvedValue(refund(400));
    m.listRefundsByPaymentTx.mockResolvedValue([refund(400), { ...refund(600, "approved"), id: randomUUID() }]);
    const q = new TestMemoryQueue();
    registerFeePaymentConsumers(q as never);
    await decide(q);
    expect(m.updatePayment).toHaveBeenCalledWith(expect.anything(), PAYMENT, TENANT, expect.objectContaining({ status: "refunded" }));
    expect(emitted("citizen.refund.approved")!.payload).toMatchObject({ fullyRefunded: true });
  });

  it("does not approve a refund that exceeds what is still refundable", async () => {
    m.findRefundByIdTx.mockResolvedValue(refund(500));
    m.listRefundsByPaymentTx.mockResolvedValue([refund(500), { ...refund(700, "approved"), id: randomUUID() }]);
    const q = new TestMemoryQueue();
    registerFeePaymentConsumers(q as never);
    await decide(q);
    expect(m.updateRefund).not.toHaveBeenCalled();
    expect(emitted("citizen.refund.approved")).toBeUndefined();
  });

  it("the request is bounded by the remaining balance, in the command and in the consumer", async () => {
    m.listRefundsByPayment.mockResolvedValue([{ ...refund(900, "approved"), id: randomUUID() }]);
    m.queue = { publish: vi.fn(async () => undefined) };
    await expect(requestRefund(ctx(MAKER), PAYMENT, { amount: 200 })).rejects.toMatchObject({ status: 422, code: "AMOUNT_TOO_HIGH" });
    await expect(requestRefund(ctx(MAKER), PAYMENT, { amount: 100 })).resolves.toBeTruthy();

    m.listRefundsByPaymentTx.mockResolvedValue([{ ...refund(900, "approved"), id: randomUUID() }]);
    const q = new TestMemoryQueue();
    registerFeePaymentConsumers(q as never);
    await q.publish(COMMANDS.refundRequest, {
      tenantId: TENANT, actorId: MAKER, correlationId: randomUUID(),
      payload: { id: randomUUID(), tenantId: TENANT, paymentId: PAYMENT, amount: 200 },
    });
    expect(m.insertRefund).not.toHaveBeenCalled();
  });
});
