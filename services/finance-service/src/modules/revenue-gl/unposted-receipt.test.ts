/**
 * V4-G-08 -- a collected citizen fee whose revenue/bank head is missing from the tenant chart of
 * accounts must NOT be silently acked. The failure has to be alertable and dead-lettered (so it can
 * be replayed once the chart is fixed), and finance.gl.rejected must carry the payment id so the
 * producing service can surface it.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { randomUUID } from "node:crypto";
import { NonRetryableError } from "@civitasone/queue";

type Handler = (msg: unknown) => Promise<void>;
class TestMemoryQueue {
  private handlers = new Map<string, Handler[]>();
  async publish(topic: string, msg: Record<string, unknown>): Promise<void> {
    for (const h of this.handlers.get(topic) ?? []) await h(msg);
  }
  subscribe(topic: string, handler: Handler): void {
    this.handlers.set(topic, [...(this.handlers.get(topic) ?? []), handler]);
  }
}

const m = vi.hoisted(() => ({
  enqueue: vi.fn(async (..._a: unknown[]) => undefined),
  markProcessed: vi.fn(async () => true),
  findHeadByCodeTx: vi.fn(),
  enqueueSpineJournal: vi.fn(async () => "journal-id"),
  captureError: vi.fn(),
}));

vi.mock("../../shared/db.js", () => {
  const tx = async (cb: (t: unknown) => Promise<void>) => { await cb({}); };
  return { scopedRead: tx, db: { transaction: tx } };
});
vi.mock("../../shared/outbox.js", () => ({ enqueue: m.enqueue, markProcessed: m.markProcessed }));
vi.mock("../../shared/infra.js", () => ({ cache: { invalidateResource: vi.fn(async () => undefined) } }));
vi.mock("../budget/repo.js", () => ({ findHeadByCodeTx: m.findHeadByCodeTx }));
vi.mock("../gl/spine.js", () => ({ enqueueSpineJournal: m.enqueueSpineJournal }));
vi.mock("@civitasone/observability", () => ({ captureError: m.captureError }));

import { registerRevenueGlConsumers } from "./consumer.js";
import { CONSUMED_EVENTS } from "../../topics.js";

const TENANT = "10000000-aaaa-4000-8000-000000000001";
const ACTOR = "20000000-bbbb-4000-8000-000000000001";

function msg(payload: Record<string, unknown>) {
  return {
    messageId: randomUUID(), type: CONSUMED_EVENTS.citizenReceiptIssued, tenantId: TENANT, actorId: ACTOR,
    correlationId: randomUUID(), schemaVersion: "1.0", payload,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  m.markProcessed.mockResolvedValue(true);
});

describe("V4-G-08 unpostable citizen receipt is visible and retriable", () => {
  for (const missing of ["revenue", "bank"] as const) {
    it(`dead-letters (NonRetryableError) and alerts when the ${missing} head is missing`, async () => {
      m.findHeadByCodeTx.mockImplementation(async (_tx: unknown, _t: string, code: string) => {
        const isBank = code === "1100";
        if ((missing === "bank") === isBank) return null;
        return { id: `head-${code}`, code };
      });
      const q = new TestMemoryQueue();
      registerRevenueGlConsumers(q as never);
      const paymentId = randomUUID();

      const run = q.publish(CONSUMED_EVENTS.citizenReceiptIssued, msg({
        id: paymentId, applicationId: randomUUID(), receiptNo: "RCT-2026-00000009", amountMinor: "50000", hoaCode: "4201",
      }));
      await expect(run).rejects.toBeInstanceOf(NonRetryableError);

      const rejected = m.enqueue.mock.calls.find((c) => (c[1] as { topic: string }).topic === "finance.gl.rejected");
      expect(rejected).toBeTruthy();
      expect(((rejected as unknown[])[1] as { payload: Record<string, unknown> }).payload).toMatchObject({
        paymentId, receiptNo: "RCT-2026-00000009", code: "INVALID_HEAD_CODE",
      });
      expect(m.captureError).toHaveBeenCalledTimes(1);
      // the rejection must not mark the message processed, or a DLQ replay after fixing the chart would be a no-op
      expect(m.markProcessed).toHaveBeenCalledTimes(1);
      expect(m.enqueueSpineJournal).not.toHaveBeenCalled();
    });
  }

  it("still posts normally when both heads exist", async () => {
    m.findHeadByCodeTx.mockImplementation(async (_tx: unknown, _t: string, code: string) => ({ id: `head-${code}`, code }));
    const q = new TestMemoryQueue();
    registerRevenueGlConsumers(q as never);
    await q.publish(CONSUMED_EVENTS.citizenReceiptIssued, msg({
      id: randomUUID(), applicationId: randomUUID(), receiptNo: "RCT-2026-00000010", amountMinor: "100",
    }));
    expect(m.enqueueSpineJournal).toHaveBeenCalledOnce();
    expect(m.captureError).not.toHaveBeenCalled();
  });
});
