/**
 * GAP-FINANCE-RECONCILIATION-01: the exception_action consumer keeps the stored
 * resolutionNote on investigate/reopen and records sub-action, status and note
 * in the audit event. Mocked: no Postgres.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

const getBreakTx = vi.fn();
const updateBreakStatus = vi.fn();
const enqueue = vi.fn();
vi.mock("../src/shared/db.js", () => ({ db: { transaction: (fn: (tx: unknown) => Promise<unknown>) => fn({}) } }));
vi.mock("../src/shared/infra.js", () => ({ cache: { invalidateResource: vi.fn() } }));
vi.mock("../src/shared/outbox.js", () => ({
  enqueue: (...a: unknown[]) => enqueue(...a),
  markProcessed: vi.fn(async () => true),
}));
vi.mock("../src/modules/recon/repo.js", () => ({
  getBreakTx: (...a: unknown[]) => getBreakTx(...a),
  updateBreakStatus: (...a: unknown[]) => updateBreakStatus(...a),
}));
vi.mock("../src/modules/recon/service.js", () => ({ runReconciliation: vi.fn() }));

import { registerReconConsumers } from "../src/modules/recon/consumer.js";

type Handler = (msg: unknown) => Promise<void>;
function handler(): Handler {
  let h: Handler | undefined;
  registerReconConsumers({ subscribe: (topic: string, fn: Handler) => { if (topic === "finance.recon.exception_action") h = fn; } } as never);
  return h!;
}
const msg = (payload: Record<string, unknown>) => ({
  messageId: "m1", actorId: "actor-1", tenantId: "t1", correlationId: "c1",
  payload: { id: "b1", tenantId: "t1", ...payload },
});
const auditPayload = () => enqueue.mock.calls.map((c) => c[1]).find((e) => e.topic === "audit.event.record")!.payload;

describe("recon exception_action consumer", () => {
  beforeEach(() => {
    getBreakTx.mockReset();
    updateBreakStatus.mockReset();
    enqueue.mockReset();
  });

  it("reopen does NOT write resolutionNote (the prior note survives)", async () => {
    getBreakTx.mockResolvedValue({ id: "b1", status: "resolved" });
    await handler()(msg({ action: "reopen", note: "reopened after bank query" }));
    const patch = updateBreakStatus.mock.calls[0]![3];
    expect(patch.status).toBe("open");
    expect(patch).not.toHaveProperty("resolutionNote");
  });

  it("investigate does NOT write resolutionNote either", async () => {
    getBreakTx.mockResolvedValue({ id: "b1", status: "open" });
    await handler()(msg({ action: "investigate" }));
    expect(updateBreakStatus.mock.calls[0]![3]).not.toHaveProperty("resolutionNote");
  });

  it("resolve stores the note and the resolver", async () => {
    getBreakTx.mockResolvedValue({ id: "b1", status: "open" });
    await handler()(msg({ action: "resolve", note: "Matched to UTR on statement" }));
    expect(updateBreakStatus.mock.calls[0]![3]).toMatchObject({
      status: "resolved", resolutionNote: "Matched to UTR on statement", resolvedBy: "actor-1",
    });
  });

  it("the audit event carries sub-action, previous/new status and the note", async () => {
    getBreakTx.mockResolvedValue({ id: "b1", status: "open" });
    await handler()(msg({ action: "write_off", note: "Bank charge approved by CFO memo 12" }));
    expect(auditPayload()).toMatchObject({
      action: "recon_exception_action",
      resourceId: "b1",
      exceptionAction: "write_off",
      previousStatus: "open",
      newStatus: "written_off",
      note: "Bank charge approved by CFO memo 12",
    });
  });
});
