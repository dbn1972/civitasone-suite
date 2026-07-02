/**
 * Treasury consumer mock tests — challan, deposit, refund, forfeit, adjust.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { randomUUID } from "node:crypto";
import { MemoryQueue } from "@civitasone/queue";

const {
  mockTx, dbTransactionFn, enqueuedMessages,
  insertChallanMock, insertDepositMock, findDepositByIdForUpdateTxMock,
  applyDepositDispositionGuardedMock, insertDepositEventMock,
  findHeadByCodeTxMock, nextDocNoMock, enqueueSpineJournalMock, postCashBookMock,
} = vi.hoisted(() => {
  const _mockTx = { insert: vi.fn().mockReturnValue({ values: vi.fn().mockResolvedValue(undefined) }) };
  const _dbTransactionFn = vi.fn(async (cb: (tx: unknown) => Promise<void>) => { await cb(_mockTx); });
  const _enqueuedMessages: Array<{ topic: string; payload: unknown }> = [];
  return {
    mockTx: _mockTx, dbTransactionFn: _dbTransactionFn as any,
    enqueuedMessages: _enqueuedMessages,
    insertChallanMock: vi.fn(async () => undefined),
    insertDepositMock: vi.fn(async () => undefined),
    findDepositByIdForUpdateTxMock: vi.fn(async () => ({ id: "d1", tenantId: "t1", balanceMinor: 500000n, pdNo: "PD/001", administrator: "Vendor" })),
    applyDepositDispositionGuardedMock: vi.fn(async () => true),
    insertDepositEventMock: vi.fn(async () => undefined),
    findHeadByCodeTxMock: vi.fn(async () => ({ id: randomUUID(), code: "1100" })),
    nextDocNoMock: vi.fn(async () => ({ docNo: "CHLN/001" })),
    enqueueSpineJournalMock: vi.fn(async () => undefined),
    postCashBookMock: vi.fn(async () => undefined),
  };
});

vi.mock("../src/shared/db.js", () => ({ db: { transaction: dbTransactionFn } }));
vi.mock("../src/shared/outbox.js", () => ({
  enqueue: vi.fn(async (_tx: unknown, msg: { topic: string; payload: unknown }) => { enqueuedMessages.push({ topic: msg.topic, payload: msg.payload }); }),
  markProcessed: vi.fn(async () => true),
}));
vi.mock("../src/modules/treasury/repo.js", () => ({
  insertChallan: (...a: any[]) => insertChallanMock(...a),
  insertDeposit: (...a: any[]) => insertDepositMock(...a),
  findDepositByIdTx: vi.fn(async () => ({ id: "d1", tenantId: "t1", balanceMinor: 500000n, pdNo: "PD/001", administrator: "V" })),
  findDepositByIdForUpdateTx: (...a: any[]) => findDepositByIdForUpdateTxMock(...a),
  applyDepositDispositionGuarded: (...a: any[]) => applyDepositDispositionGuardedMock(...a),
  insertDepositEvent: (...a: any[]) => insertDepositEventMock(...a),
}));
vi.mock("../src/modules/budget/repo.js", () => ({
  findHeadByCodeTx: (...a: any[]) => findHeadByCodeTxMock(...a),
}));
vi.mock("../src/modules/gl/spine.js", () => ({
  enqueueSpineJournal: (...a: any[]) => enqueueSpineJournalMock(...a),
  deterministicId: (s: string) => `det-${s.slice(0, 8)}`,
}));
vi.mock("../src/shared/cashbook.js", () => ({
  postCashBook: (...a: any[]) => postCashBookMock(...a),
}));
vi.mock("../src/modules/hoa/voucher.js", () => ({
  fyFromDate: () => "2025-26",
  nextDocNo: (...a: any[]) => nextDocNoMock(...a),
}));

import { registerTreasuryConsumers } from "../src/modules/treasury/consumer.js";
import { COMMANDS } from "../src/topics.js";

const TENANT = "10000000-aaaa-4000-8000-000000000001";
const ACTOR = "20000000-bbbb-4000-8000-000000000001";
function makeMsg(type: string, payload: Record<string, unknown>) {
  return { messageId: randomUUID(), type, tenantId: TENANT, actorId: ACTOR, correlationId: randomUUID(), schemaVersion: "1.0", payload };
}
const settle = () => new Promise<void>((r) => setTimeout(r, 100));

beforeEach(() => {
  vi.clearAllMocks(); enqueuedMessages.length = 0;
  dbTransactionFn.mockImplementation(async (cb: (tx: unknown) => Promise<void>) => { await cb(mockTx); });
  findDepositByIdForUpdateTxMock.mockResolvedValue({ id: "d1", tenantId: TENANT, balanceMinor: 500000n, pdNo: "PD/001", administrator: "Vendor" });
  applyDepositDispositionGuardedMock.mockResolvedValue(true);
});

describe("challanCreate command", () => {
  it("inserts challan with gapless number and posts GL + cash book", async () => {
    const q = new MemoryQueue(); registerTreasuryConsumers(q); await q.start();
    await q.publish(COMMANDS.challanCreate, makeMsg(COMMANDS.challanCreate, {
      id: randomUUID(), tenantId: TENANT, challanNo: "C001",
      receiptHeadId: randomUUID(), depositor: "ABC Corp", amountMinor: 1000000,
    }));
    await settle();
    expect(insertChallanMock).toHaveBeenCalledOnce();
    expect(enqueueSpineJournalMock).toHaveBeenCalledOnce();
    expect(postCashBookMock).toHaveBeenCalledOnce();
    await q.stop();
  });
});

describe("depositCreate command", () => {
  it("inserts deposit with GL posting", async () => {
    const q = new MemoryQueue(); registerTreasuryConsumers(q); await q.start();
    await q.publish(COMMANDS.depositCreate, makeMsg(COMMANDS.depositCreate, {
      id: randomUUID(), tenantId: TENANT, pdNo: "PD001", type: "security",
      administrator: "Contractor", balanceMinor: 500000,
    }));
    await settle();
    expect(insertDepositMock).toHaveBeenCalledOnce();
    expect(enqueueSpineJournalMock).toHaveBeenCalledOnce();
    await q.stop();
  });
});

describe("depositRefund command", () => {
  it("applies refund, posts GL Dr Liability Cr Bank, cash book out", async () => {
    const q = new MemoryQueue(); registerTreasuryConsumers(q); await q.start();
    await q.publish(COMMANDS.depositRefund, makeMsg(COMMANDS.depositRefund, {
      id: randomUUID(), tenantId: TENANT, depositId: "d1", amountMinor: 200000,
    }));
    await settle();
    expect(applyDepositDispositionGuardedMock).toHaveBeenCalledOnce();
    expect(enqueueSpineJournalMock).toHaveBeenCalledOnce();
    expect(postCashBookMock).toHaveBeenCalledOnce();
    expect(insertDepositEventMock).toHaveBeenCalledOnce();
    await q.stop();
  });
});

describe("depositForfeit command", () => {
  it("applies forfeiture, posts GL Dr Liability Cr Income", async () => {
    const q = new MemoryQueue(); registerTreasuryConsumers(q); await q.start();
    await q.publish(COMMANDS.depositForfeit, makeMsg(COMMANDS.depositForfeit, {
      id: randomUUID(), tenantId: TENANT, depositId: "d1", amountMinor: 100000,
    }));
    await settle();
    expect(applyDepositDispositionGuardedMock).toHaveBeenCalledOnce();
    expect(enqueueSpineJournalMock).toHaveBeenCalledOnce();
    expect(insertDepositEventMock).toHaveBeenCalledOnce();
    // No cash book for forfeiture (income recognition only)
    expect(postCashBookMock).not.toHaveBeenCalled();
    await q.stop();
  });
});

describe("depositAdjust command", () => {
  it("applies adjust-against-bill, posts GL Dr Liability Cr AP", async () => {
    const q = new MemoryQueue(); registerTreasuryConsumers(q); await q.start();
    await q.publish(COMMANDS.depositAdjust, makeMsg(COMMANDS.depositAdjust, {
      id: randomUUID(), tenantId: TENANT, depositId: "d1", amountMinor: 150000,
    }));
    await settle();
    expect(applyDepositDispositionGuardedMock).toHaveBeenCalledOnce();
    expect(enqueueSpineJournalMock).toHaveBeenCalledOnce();
    expect(insertDepositEventMock).toHaveBeenCalledOnce();
    await q.stop();
  });
});
