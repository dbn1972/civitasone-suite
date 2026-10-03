import { describe, it, expect, vi, beforeEach } from "vitest";

const enqueue = vi.hoisted(() => vi.fn());
const findById = vi.hoisted(() => vi.fn());
const transitionTx = vi.hoisted(() => vi.fn());
vi.mock("../src/shared/outbox.js", () => ({ enqueue }));
vi.mock("../src/shared/db.js", () => ({ db: { transaction: async (cb: (tx: unknown) => unknown) => cb({}) } }));
vi.mock("../src/modules/instruments/repo.js", () => ({ findById, transitionTx }));

import { cancelInstrument } from "../src/modules/instruments/commands.js";

const ctx = { tenantId: "t1", actorId: "actor-1", correlationId: "c1" } as never;
const row = (status: string) => ({
  id: "i1", instrumentType: "cheque", instrumentNo: "000123", bankAccountId: null, bankName: "SBI", payee: "A",
  amountMinor: 100n, currency: "INR", issueDate: "2025-03-01", status, presentedAt: null, clearedAt: null,
  bouncedAt: null, cancelledAt: null, bounceReason: null, paymentId: null, version: 1,
});

describe("cancelInstrument audit (GAP-FINANCE-TREASURY-CHEQUES-DETAIL-04)", () => {
  beforeEach(() => { enqueue.mockReset(); findById.mockReset(); transitionTx.mockReset(); });

  it("audits the cancel once with actor and before/after status", async () => {
    findById.mockResolvedValue(row("issued"));
    transitionTx.mockResolvedValue(row("cancelled"));
    await cancelInstrument(ctx, "i1", { reason: "Cheque lost in transit" });
    expect(enqueue).toHaveBeenCalledTimes(1);
    const evt = enqueue.mock.calls[0][1];
    expect(evt.topic).toBe("audit.event.record");
    expect(evt.actorId).toBe("actor-1");
    expect(evt.payload).toMatchObject({ action: "cancel", resourceType: "instrument", resourceId: "i1", details: { fromStatus: "issued", toStatus: "cancelled" } });
  });

  it("an already-cancelled instrument is an idempotent replay: no write, no second audit", async () => {
    findById.mockResolvedValue(row("cancelled"));
    await cancelInstrument(ctx, "i1", { reason: "Cheque lost in transit" });
    expect(transitionTx).not.toHaveBeenCalled();
    expect(enqueue).not.toHaveBeenCalled();
  });

  it("a concurrent loser (guard misses, row now cancelled) does not audit again", async () => {
    findById.mockResolvedValueOnce(row("issued")).mockResolvedValueOnce(row("cancelled"));
    transitionTx.mockResolvedValue(null);
    await cancelInstrument(ctx, "i1", { reason: "Cheque lost in transit" });
    expect(enqueue).not.toHaveBeenCalled();
  });

  it("an illegal transition (presented) is a 409 and writes no audit", async () => {
    findById.mockResolvedValueOnce(row("presented")).mockResolvedValueOnce(row("presented"));
    transitionTx.mockResolvedValue(null);
    await expect(cancelInstrument(ctx, "i1", { reason: "Cheque lost in transit" })).rejects.toMatchObject({ status: 409 });
    expect(enqueue).not.toHaveBeenCalled();
  });
});
