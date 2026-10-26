/**
 * V4-G-08 -- finance.gl.rejected (a collected fee that could not be posted to the GL) used to have
 * no citizen consumer, so revenue was receipted and never booked with no trace on the citizen side.
 * The citizen service now records a failure audit event against the payment.
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
  enqueue: vi.fn(async (..._a: unknown[]) => undefined),
  markProcessed: vi.fn(async () => true),
  findPaymentByIdTx: vi.fn(),
}));

vi.mock("../../shared/db.js", () => ({ db: { transaction: async (cb: (tx: unknown) => unknown) => cb({}) } }));
vi.mock("../../shared/outbox.js", () => ({ enqueue: m.enqueue, markProcessed: m.markProcessed }));
vi.mock("../../shared/infra.js", () => ({
  cache: { invalidate: vi.fn(async () => undefined), makeKey: (...p: string[]) => p.join(":") },
}));
vi.mock("../../shared/tenant-queue.js", () => ({ tenantScoped: (q: unknown) => q }));
vi.mock("./repo.js", () => ({ findPaymentByIdTx: m.findPaymentByIdTx }));
vi.mock("../catalogue/repo.js", () => ({ findPublishedByServiceIdTx: vi.fn() }));
vi.mock("../application/repo.js", () => ({ findApplicationByIdTx: vi.fn() }));

import { registerFeePaymentConsumers } from "./consumer.js";
import { CONSUMED_EVENTS } from "../../topics.js";

const TENANT = "10000000-aaaa-4000-8000-000000000001";
const ACTOR = "20000000-bbbb-4000-8000-000000000001";
const PAYMENT = "30000000-cccc-4000-8000-000000000001";

const rejection = (payload: Record<string, unknown>) => ({
  tenantId: TENANT, actorId: ACTOR, correlationId: randomUUID(), payload,
});

beforeEach(() => {
  vi.clearAllMocks();
  m.markProcessed.mockResolvedValue(true);
  m.findPaymentByIdTx.mockResolvedValue({ id: PAYMENT, tenantId: TENANT, receiptNo: "RCT-2026-00000009" });
});

describe("V4-G-08 citizen consumes finance.gl.rejected", () => {
  it("records a failure audit event against the unposted payment", async () => {
    const q = new TestMemoryQueue();
    registerFeePaymentConsumers(q as never);
    await q.publish(CONSUMED_EVENTS.financeGlRejected, rejection({
      paymentId: PAYMENT, receiptNo: "RCT-2026-00000009", code: "INVALID_HEAD_CODE", reason: "INVALID_HEAD_CODE: revenue head code '4201' not found",
    }));
    const evt = m.enqueue.mock.calls.find((c) => (c[1] as { topic: string }).topic === "audit.event.record");
    expect(evt).toBeTruthy();
    expect(((evt as unknown[])[1] as { payload: Record<string, unknown> }).payload).toMatchObject({
      service: "citizen", action: "payment_gl_post_failed", resourceType: "payment", resourceId: PAYMENT, outcome: "failure",
    });
  });

  it("ignores rejections that are not about a citizen payment (e.g. asset journals)", async () => {
    const q = new TestMemoryQueue();
    registerFeePaymentConsumers(q as never);
    await q.publish(CONSUMED_EVENTS.financeGlRejected, rejection({ journalId: randomUUID(), code: "PERIOD_CLOSED" }));
    expect(m.enqueue).not.toHaveBeenCalled();
  });

  it("ignores a rejection for a payment this tenant does not have", async () => {
    m.findPaymentByIdTx.mockResolvedValue(null);
    const q = new TestMemoryQueue();
    registerFeePaymentConsumers(q as never);
    await q.publish(CONSUMED_EVENTS.financeGlRejected, rejection({ paymentId: PAYMENT, code: "INVALID_HEAD_CODE" }));
    expect(m.enqueue).not.toHaveBeenCalled();
  });
});
