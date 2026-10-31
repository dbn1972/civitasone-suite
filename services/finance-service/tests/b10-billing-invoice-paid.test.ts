/**
 * F92 (UAT T6-04): billing.invoice.paid carries `totalMinor` (billing-service, both settle paths); finance read
 * `paidMinor`, so every paid invoice died on BigInt(undefined) and dead-lettered. Mocked-DB unit style.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { randomUUID, createHash } from "node:crypto";
import { NonRetryableError } from "@civitasone/queue";

const m = vi.hoisted(() => ({
  enqueue: vi.fn(async (..._a: unknown[]) => undefined),
  markProcessed: vi.fn(async (..._a: unknown[]) => true),
}));
vi.mock("../src/shared/db.js", () => {
  const tx = async (cb: (t: unknown) => Promise<void>) => { await cb({}); };
  return { scopedRead: tx, db: { transaction: tx } };
});
vi.mock("../src/shared/outbox.js", () => ({ enqueue: m.enqueue, markProcessed: m.markProcessed }));

import { registerRevenueBillingConsumers } from "../src/modules/revenue-billing/consumer.js";
import { invoicePaidAmountMinor } from "../src/modules/revenue-billing/payload.js";

const TENANT = "10000000-aaaa-4000-8000-0000000b1092";
const detId = (key: string) => {
  const h = createHash("sha256").update(key).digest("hex");
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20, 32)}`;
};

function handlerFor(topic: string): (msg: unknown) => Promise<void> {
  const handlers = new Map<string, (msg: unknown) => Promise<void>>();
  registerRevenueBillingConsumers({ subscribe: (t: string, h: (msg: unknown) => Promise<void>) => { handlers.set(t, h); } } as never);
  return handlers.get(topic)!;
}
const deliver = (payload: Record<string, unknown>) => handlerFor("billing.invoice.paid")({
  messageId: randomUUID(), tenantId: TENANT, actorId: randomUUID(), correlationId: randomUUID(), payload,
});
const journal = () => (m.enqueue.mock.calls.find((c) => (c[1] as { topic: string }).topic === "finance.gl.post")?.[1] as { payload: any } | undefined)?.payload;

beforeEach(() => { vi.clearAllMocks(); });

describe("billing.invoice.paid -> cash receipt journal", () => {
  it("posts the amount from totalMinor, the field billing actually sends", async () => {
    const invoiceId = randomUUID();
    await deliver({ invoiceId, totalMinor: "499900" });
    const j = journal();
    expect(j).toBeTruthy();
    expect(j.type).toBe("billing_cash_receipt");
    expect(j.lines.map((l: any) => [l.accountCode, l.debitMinor, l.creditMinor])).toEqual([["1100", "499900", "0"], ["1300", "0", "499900"]]);
    // deterministic per invoice: a replayed event cannot post a second journal
    expect(j.id).toBe(detId(`billing_invoice_paid:${invoiceId}`));
  });

  it("still accepts paidMinor from anything queued under the old reading", async () => {
    await deliver({ invoiceId: randomUUID(), paidMinor: "1000" });
    expect(journal().lines[0].debitMinor).toBe("1000");
  });

  it("a payload with no amount is a contract violation: dead-lettered, not retried, nothing posted", async () => {
    const err = await deliver({ invoiceId: randomUUID() }).then(() => null, (e: unknown) => e);
    expect(err).toBeInstanceOf(NonRetryableError);
    expect(journal()).toBeUndefined();
  });

  it("invoicePaidAmountMinor prefers totalMinor and rejects non-integers", () => {
    expect(invoicePaidAmountMinor({ totalMinor: "5", paidMinor: "7" })).toBe(5n);
    expect(invoicePaidAmountMinor({ totalMinor: 12 })).toBe(12n);
    expect(invoicePaidAmountMinor({ totalMinor: "1.5" })).toBeNull();
    expect(invoicePaidAmountMinor({})).toBeNull();
  });
});
