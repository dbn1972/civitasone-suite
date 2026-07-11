/**
 * order-issuance consumer tests — the maker-checker approval + DSC-pronouncement
 * state machine. db/outbox/repo/schema are mocked; the REAL state machine, the
 * REAL maker-checker guard, and the REAL NonRetryableError are used so the
 * integrity logic is genuinely exercised end-to-end.
 */
import { describe, it, expect, beforeEach, vi } from "vitest";

vi.mock("../src/shared/infra.js", () => ({
  cache: { invalidateAfterCommit: vi.fn(async () => {}), makeKey: (...a: string[]) => a.join(":") },
  queue: { publish: vi.fn(async () => {}) },
}));
import { randomUUID } from "node:crypto";

const processedIds = new Set<string>();
let currentOrder:
  | { status: string; version: number; createdBy: string | null; signedBy: string | null }
  | undefined;

vi.mock("../src/shared/db.js", () => ({
  db: { transaction: async (fn: (tx: unknown) => Promise<unknown>) => fn({ __tx: true }) },
}));

vi.mock("../src/shared/outbox.js", () => ({
  markProcessed: vi.fn(async (_tx: unknown, id: string) => {
    if (processedIds.has(id)) return false;
    processedIds.add(id);
    return true;
  }),
  enqueue: vi.fn(async () => {}),
  versionedUpdate: vi.fn(async () => {}),
}));

vi.mock("../src/modules/order/schema.js", () => ({ orders: {} }));

vi.mock("../src/modules/order-issuance/repo.js", () => ({
  getOrderForIssuance: vi.fn(async () => currentOrder),
}));

vi.mock("../src/topics.js", () => ({
  COMMANDS: {
    submitOrderForApproval: "court.order.submit_approval",
    approveAndIssueOrder:   "court.order.approve_issue",
    sendBackOrder:          "court.order.send_back",
    recallOrder:            "court.order.recall",
  },
  EVENTS: {
    orderPendingApproval: "court.order.pending_approval",
    orderIssued:          "court.order.issued",
    orderSentBack:        "court.order.sent_back",
    orderRecalled:        "court.order.recalled",
  },
}));

import { registerOrderIssuanceConsumers } from "../src/modules/order-issuance/consumer.js";
import * as repo from "../src/modules/order-issuance/repo.js";
import { enqueue, versionedUpdate } from "../src/shared/outbox.js";

function makeHarness() {
  const handlers = new Map<string, (msg: unknown) => Promise<void>>();
  const register = (topic: string, h: (msg: unknown) => Promise<void>) => { handlers.set(topic, h); };
  return { register: register as never, deliver: (topic: string, msg: unknown) => handlers.get(topic)!(msg) };
}

function submitMsg(orderId: string, expectedVersion: number, messageId = randomUUID()) {
  return {
    messageId, type: "court.order.submit_approval",
    tenantId: randomUUID(), actorId: randomUUID(), correlationId: "c", schemaVersion: "1.0",
    payload: { orderId, tenantId: randomUUID(), expectedVersion },
  };
}
function issueMsg(orderId: string, expectedVersion: number, actorId: string, opts: { dscSignature?: string; issuedDate?: string; messageId?: string } = {}) {
  return {
    messageId: opts.messageId ?? randomUUID(), type: "court.order.approve_issue",
    tenantId: randomUUID(), actorId, correlationId: "c", schemaVersion: "1.0",
    payload: {
      orderId, tenantId: randomUUID(),
      dscSignature: opts.dscSignature ?? "MIIBdummySignatureBlob==",
      ...(opts.issuedDate ? { issuedDate: opts.issuedDate } : {}),
      expectedVersion,
    },
  };
}
function recallMsg(orderId: string, expectedVersion: number, recallReason: string, messageId = randomUUID()) {
  return {
    messageId, type: "court.order.recall",
    tenantId: randomUUID(), actorId: randomUUID(), correlationId: "c", schemaVersion: "1.0",
    payload: { orderId, tenantId: randomUUID(), recallReason, expectedVersion },
  };
}

function topicsEnqueued(): string[] {
  return (enqueue as ReturnType<typeof vi.fn>).mock.calls.map((c) => (c[1] as { topic: string }).topic);
}
function lastVersionedSet(): Record<string, unknown> {
  const calls = (versionedUpdate as ReturnType<typeof vi.fn>).mock.calls;
  return (calls[calls.length - 1]![2] as { set: Record<string, unknown> }).set;
}

describe("order-issuance consumer", () => {
  beforeEach(() => { processedIds.clear(); currentOrder = undefined; vi.clearAllMocks(); });

  it("submits a draft for approval and emits orderPendingApproval + audit", async () => {
    currentOrder = { status: "draft", version: 1, createdBy: randomUUID(), signedBy: null };
    const { register, deliver } = makeHarness();
    registerOrderIssuanceConsumers(register);
    await deliver("court.order.submit_approval", submitMsg("o1", 1));
    expect(versionedUpdate).toHaveBeenCalledTimes(1);
    expect(topicsEnqueued()).toContain("court.order.pending_approval");
    expect(topicsEnqueued()).toContain("audit.event.record");
  });

  it("submit is exactly-once on redelivery", async () => {
    currentOrder = { status: "draft", version: 1, createdBy: randomUUID(), signedBy: null };
    const { register, deliver } = makeHarness();
    registerOrderIssuanceConsumers(register);
    const m = submitMsg("o1", 1, "fixed");
    await deliver("court.order.submit_approval", m);
    await deliver("court.order.submit_approval", m);
    expect(versionedUpdate).toHaveBeenCalledTimes(1);
  });

  // ── MAKER-CHECKER: the integrity crux ──────────────────────────────────────────
  it("REJECTS approve+issue when the issuer is the order's maker (createdBy) — no write", async () => {
    const maker = randomUUID();
    currentOrder = { status: "pending_approval", version: 2, createdBy: maker, signedBy: null };
    const { register, deliver } = makeHarness();
    registerOrderIssuanceConsumers(register);
    await expect(
      deliver("court.order.approve_issue", issueMsg("o1", 2, maker)),
    ).rejects.toThrow(/MAKER_CHECKER_VIOLATION/);
    expect(versionedUpdate).not.toHaveBeenCalled();
    expect(topicsEnqueued()).not.toContain("court.order.issued");
  });

  it("REJECTS approve+issue when issuer matches the maker via signedBy fallback", async () => {
    const maker = randomUUID();
    currentOrder = { status: "pending_approval", version: 2, createdBy: null, signedBy: maker };
    const { register, deliver } = makeHarness();
    registerOrderIssuanceConsumers(register);
    await expect(
      deliver("court.order.approve_issue", issueMsg("o1", 2, maker)),
    ).rejects.toThrow(/MAKER_CHECKER_VIOLATION/);
    expect(versionedUpdate).not.toHaveBeenCalled();
  });

  it("ISSUES when the approver differs from the maker (sets approvedBy/issuedAt/dscSignature)", async () => {
    const maker = randomUUID();
    const checker = randomUUID();
    currentOrder = { status: "pending_approval", version: 2, createdBy: maker, signedBy: null };
    const { register, deliver } = makeHarness();
    registerOrderIssuanceConsumers(register);
    await deliver("court.order.approve_issue", issueMsg("o1", 2, checker, { dscSignature: "SIG-BLOB", issuedDate: "2026-07-11" }));
    expect(versionedUpdate).toHaveBeenCalledTimes(1);
    const set = lastVersionedSet();
    expect(set.status).toBe("issued");
    expect(set.approvedBy).toBe(checker);
    expect(set.dscSignature).toBe("SIG-BLOB");
    expect(set.orderDate).toBe("2026-07-11");
    expect(set.issuedAt).toBeInstanceOf(Date);
    expect(topicsEnqueued()).toContain("court.order.issued");
  });

  it("issue leaves order_date untouched when issuedDate is omitted", async () => {
    currentOrder = { status: "pending_approval", version: 2, createdBy: randomUUID(), signedBy: null };
    const { register, deliver } = makeHarness();
    registerOrderIssuanceConsumers(register);
    await deliver("court.order.approve_issue", issueMsg("o1", 2, randomUUID()));
    const set = lastVersionedSet();
    expect("orderDate" in set).toBe(false);
    expect(set.status).toBe("issued");
  });

  it("rejects approve+issue for an unknown order (ORDER_NOT_FOUND)", async () => {
    currentOrder = undefined;
    const { register, deliver } = makeHarness();
    registerOrderIssuanceConsumers(register);
    await expect(
      deliver("court.order.approve_issue", issueMsg("nope", 1, randomUUID())),
    ).rejects.toThrow(/ORDER_NOT_FOUND/);
    expect(versionedUpdate).not.toHaveBeenCalled();
  });

  it("rejects a stale optimistic-lock token (VERSION_CONFLICT)", async () => {
    currentOrder = { status: "pending_approval", version: 5, createdBy: randomUUID(), signedBy: null };
    const { register, deliver } = makeHarness();
    registerOrderIssuanceConsumers(register);
    await expect(
      deliver("court.order.approve_issue", issueMsg("o1", 1, randomUUID())),
    ).rejects.toThrow(/VERSION_CONFLICT/);
    expect(versionedUpdate).not.toHaveBeenCalled();
  });

  it("rejects an illegal transition (issue a draft — cannot skip approval)", async () => {
    currentOrder = { status: "draft", version: 1, createdBy: randomUUID(), signedBy: null };
    const { register, deliver } = makeHarness();
    registerOrderIssuanceConsumers(register);
    await expect(
      deliver("court.order.approve_issue", issueMsg("o1", 1, randomUUID())),
    ).rejects.toThrow(/INVALID_ISSUANCE_TRANSITION/);
    expect(versionedUpdate).not.toHaveBeenCalled();
  });

  it("is a no-op when the order is already issued (redelivery-safe)", async () => {
    currentOrder = { status: "issued", version: 3, createdBy: randomUUID(), signedBy: null };
    const { register, deliver } = makeHarness();
    registerOrderIssuanceConsumers(register);
    await deliver("court.order.approve_issue", issueMsg("o1", 3, randomUUID()));
    expect(versionedUpdate).not.toHaveBeenCalled();
  });

  it("sends a pending order back to draft and emits orderSentBack", async () => {
    currentOrder = { status: "pending_approval", version: 2, createdBy: randomUUID(), signedBy: null };
    const { register, deliver } = makeHarness();
    registerOrderIssuanceConsumers(register);
    await deliver("court.order.send_back", {
      messageId: randomUUID(), type: "court.order.send_back",
      tenantId: randomUUID(), actorId: randomUUID(), correlationId: "c", schemaVersion: "1.0",
      payload: { orderId: "o1", tenantId: randomUUID(), remarks: "fix the operative para", expectedVersion: 2 },
    });
    expect(versionedUpdate).toHaveBeenCalledTimes(1);
    expect(lastVersionedSet().status).toBe("draft");
    expect(topicsEnqueued()).toContain("court.order.sent_back");
  });

  it("recalls an issued order and sets recallReason", async () => {
    currentOrder = { status: "issued", version: 4, createdBy: randomUUID(), signedBy: null };
    const { register, deliver } = makeHarness();
    registerOrderIssuanceConsumers(register);
    await deliver("court.order.recall", recallMsg("o1", 4, "superseded by review order"));
    expect(versionedUpdate).toHaveBeenCalledTimes(1);
    const set = lastVersionedSet();
    expect(set.status).toBe("recalled");
    expect(set.recallReason).toBe("superseded by review order");
    expect(topicsEnqueued()).toContain("court.order.recalled");
  });

  it("recall of an unknown order is ORDER_NOT_FOUND", async () => {
    currentOrder = undefined;
    const { register, deliver } = makeHarness();
    registerOrderIssuanceConsumers(register);
    await expect(
      deliver("court.order.recall", recallMsg("nope", 1, "x")),
    ).rejects.toThrow(/ORDER_NOT_FOUND/);
    expect(versionedUpdate).not.toHaveBeenCalled();
  });
});
