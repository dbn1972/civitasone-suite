/** B22 D5: the revenue-billing consumer hands billing.invoice.issued / .paid to the AR sub-ledger (mocked-DB unit style). */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { randomUUID } from "node:crypto";

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

const TENANT = "10000000-aaaa-4000-8000-0000000b2203";
const handlers = new Map<string, (msg: unknown) => Promise<void>>();
registerRevenueBillingConsumers({ subscribe: (t: string, h: (msg: unknown) => Promise<void>) => { handlers.set(t, h); } } as never);
const deliver = (topic: string, payload: Record<string, unknown>) => handlers.get(topic)!({
  messageId: randomUUID(), tenantId: TENANT, actorId: randomUUID(), correlationId: randomUUID(), payload,
});
const arSync = () => m.enqueue.mock.calls.map((c) => c[1] as { topic: string; payload: Record<string, string> }).filter((e) => e.topic === "finance.subledger.ar.sync");

beforeEach(() => { vi.clearAllMocks(); });

describe("billing events feed the AR sub-ledger", () => {
  it("issued: one ar.sync 'issued' with the invoice total, next to the 1300 journal", async () => {
    const invoiceId = randomUUID();
    await deliver("billing.invoice.issued", { invoiceId, totalMinor: "250000", issuedDate: "2026-11-02" });
    expect(arSync()).toHaveLength(1);
    expect(arSync()[0]!.payload).toEqual({ event: "issued", invoiceId, totalMinor: "250000", date: "2026-11-02" });
    expect(m.enqueue.mock.calls.some((c) => (c[1] as { topic: string }).topic === "finance.gl.post")).toBe(true);
  });
  it("paid: one ar.sync 'paid' with the invoice total", async () => {
    const invoiceId = randomUUID();
    await deliver("billing.invoice.paid", { invoiceId, totalMinor: "250000", paidDate: "2026-11-03" });
    expect(arSync()).toHaveLength(1);
    expect(arSync()[0]!.payload).toEqual({ event: "paid", invoiceId, totalMinor: "250000", date: "2026-11-03" });
  });
});
