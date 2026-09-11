/**
 * TX-007 regression test: finance.payment.eft.initiate must never hold a DB
 * transaction open while the SFTP (NACH bank-file) upload is in flight.
 *
 * Source: services/finance-service/src/modules/integrations/consumer.ts
 * Gap:    docs/ENTERPRISE-GAP-REPORT-2026-09-07.md — TX-007
 *
 * Before the fix, `uploadBankFile(...)` was awaited from inside the handler's
 * single `db.transaction(async (tx) => { ... })` callback, so a slow or
 * hanging SFTP gateway would keep the DB connection/transaction open for the
 * duration of the upload (lock hold time, transaction timeout, pool
 * exhaustion risk under load) even though this topic has no producer today
 * (dead path).
 *
 * After the fix, the batch row / paymentMade event / audit record all commit
 * in ONE transaction *before* the SFTP call ever starts; the upload runs with
 * no transaction open; and a successful upload is recorded via a SEPARATE
 * follow-up transaction. These tests prove that ordering with a controllable
 * (deferred) SFTP call, rather than asserting on internal implementation
 * details.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { randomUUID } from "node:crypto";

// ---------------------------------------------------------------------------
// Lightweight in-process MemoryQueue (same shape used by
// three-way-match-consumer.test.ts for this same consumer module).
// ---------------------------------------------------------------------------
type Handler = (msg: any) => Promise<void>;
class TestMemoryQueue {
  private handlers = new Map<string, Handler[]>();
  async publish(topic: string, input: any): Promise<string> {
    const msg = {
      messageId: input.messageId ?? randomUUID(),
      type: input.type ?? topic,
      tenantId: input.tenantId,
      actorId: input.actorId,
      correlationId: input.correlationId,
      timestamp: new Date().toISOString(),
      schemaVersion: input.schemaVersion ?? "1.0",
      payload: input.payload,
    };
    const handlers = this.handlers.get(topic) ?? [];
    setTimeout(() => { for (const h of handlers) void h(msg); }, 0);
    return msg.messageId;
  }
  subscribe(topic: string, handler: Handler, _opts?: unknown): void {
    const list = this.handlers.get(topic) ?? [];
    list.push(handler);
    this.handlers.set(topic, list);
  }
  async start(): Promise<void> {}
  async stop(): Promise<void> { this.handlers.clear(); }
}

// ---------------------------------------------------------------------------
// Module mocks
// ---------------------------------------------------------------------------
const {
  mockTx,
  dbTransactionFn,
  enqueueMock,
  markProcessedMock,
  insertPfmsBatchMock,
  updatePfmsBatchMock,
  getTenantConfigTxMock,
  uploadBankFileMock,
  events,
} = vi.hoisted(() => {
  const _mockTx = { __tag: "tx" };
  // Records every observable step, in order, with a monotonic counter --
  // this is what lets the tests prove the SFTP call happens strictly after
  // the first transaction's callback has already resolved (i.e. committed),
  // and that the follow-up write is a second, separate transaction.
  const _events: string[] = [];
  const _dbTransactionFn = vi.fn(async (cb: (tx: unknown) => Promise<unknown>) => {
    const n = _dbTransactionFn.mock.calls.length; // 1-based after push below
    _events.push(`tx${n}:start`);
    const result = await cb(_mockTx);
    _events.push(`tx${n}:commit`);
    return result;
  });
  const _enqueueMock = vi.fn(async () => undefined);
  const _markProcessedMock = vi.fn(async () => true);
  const _insertPfmsBatchMock = vi.fn(async () => undefined);
  const _updatePfmsBatchMock = vi.fn(async () => undefined);
  const _getTenantConfigTxMock = vi.fn(async () => ({ agencyCode: "AG001", defaultDdo: "DDO001" }));
  const _uploadBankFileMock = vi.fn();
  return {
    mockTx: _mockTx,
    dbTransactionFn: _dbTransactionFn as any,
    enqueueMock: _enqueueMock as any,
    markProcessedMock: _markProcessedMock as any,
    insertPfmsBatchMock: _insertPfmsBatchMock as any,
    updatePfmsBatchMock: _updatePfmsBatchMock as any,
    getTenantConfigTxMock: _getTenantConfigTxMock as any,
    uploadBankFileMock: _uploadBankFileMock as any,
    events: _events,
  };
});

vi.mock("../src/shared/db.js", () => ({
  db: { transaction: dbTransactionFn },
}));

vi.mock("../src/shared/outbox.js", () => ({
  enqueue: (...args: any[]) => enqueueMock(...args),
  markProcessed: (...args: any[]) => markProcessedMock(...args),
}));

vi.mock("../src/modules/audit/repo.js", () => ({
  insertAuditPara: vi.fn(async () => undefined),
}));

vi.mock("../src/modules/payments/repo.js", () => ({
  upsertGrnMatch: vi.fn(async () => undefined),
}));

vi.mock("../src/modules/pfms/repo.js", () => ({
  getTenantConfigTx: (...args: any[]) => getTenantConfigTxMock(...args),
  insertPfmsBatch: (...args: any[]) => insertPfmsBatchMock(...args),
  updatePfmsBatch: (...args: any[]) => updatePfmsBatchMock(...args),
}));

vi.mock("../src/modules/integrations/bank-file-generator.js", () => ({
  generateNACHFile: vi.fn(() => "NACH-CONTENT"),
}));

vi.mock("../src/modules/integrations/sftp-egress.js", () => ({
  uploadBankFile: (...args: any[]) => uploadBankFileMock(...args),
}));

vi.mock("node:fs/promises", () => ({
  writeFile: vi.fn(async () => undefined),
  unlink: vi.fn(async () => undefined),
}));

// ---------------------------------------------------------------------------
// Import the consumer AFTER mocks
// ---------------------------------------------------------------------------
import { registerIntegrationConsumers } from "../src/modules/integrations/consumer.js";
import { CONSUMED_EVENTS, EVENTS } from "../src/topics.js";

const TENANT = "10000000-aaaa-4000-8000-000000000001";
const ACTOR = "20000000-bbbb-4000-8000-000000000001";

function makeMsg(payload: Record<string, unknown>) {
  return {
    messageId: randomUUID(),
    type: CONSUMED_EVENTS.eftInitiate,
    tenantId: TENANT,
    actorId: ACTOR,
    correlationId: `corr-${randomUUID()}`,
    schemaVersion: "1.0",
    payload,
  };
}

async function buildQueue(): Promise<TestMemoryQueue> {
  const q = new TestMemoryQueue();
  registerIntegrationConsumers(q as any);
  await q.start();
  return q;
}

const settle = () => new Promise<void>((r) => setTimeout(r, 50));

const BASE_PAYLOAD = {
  disbursementId: "disb-001",
  amountMinor: "500000",
  currency: "INR",
  pfmsTxnId: "PFMS-TXN-001",
  mode: "NEFT",
  beneficiaryBankRef: "HDFC0001234:1234567890",
};

/** A promise the test controls the resolution/rejection timing of. */
function deferred<T>() {
  let resolve!: (v: T) => void;
  let reject!: (e: unknown) => void;
  const promise = new Promise<T>((res, rej) => { resolve = res; reject = rej; });
  return { promise, resolve, reject };
}

beforeEach(() => {
  vi.clearAllMocks();
  events.length = 0;
  markProcessedMock.mockResolvedValue(true);
});

describe("finance.payment.eft.initiate — TX-007 transaction scope", () => {
  it("commits the DB transaction (batch row + paymentMade event + audit) BEFORE the SFTP upload starts, and does not hold a transaction open while the upload is pending", async () => {
    const sftp = deferred<string | null>();
    uploadBankFileMock.mockImplementation(() => {
      events.push("sftp:start");
      return sftp.promise;
    });

    const q = await buildQueue();
    await q.publish(CONSUMED_EVENTS.eftInitiate, makeMsg(BASE_PAYLOAD));
    await settle();

    // The first transaction must already have committed by the time the SFTP
    // call is made -- proving the network I/O is no longer nested inside it.
    expect(events).toEqual(["tx1:start", "tx1:commit", "sftp:start"]);

    // The batch/event/audit writes already happened, independently of the
    // (still-pending) SFTP call below.
    expect(insertPfmsBatchMock).toHaveBeenCalledTimes(1);
    expect(insertPfmsBatchMock.mock.calls[0][1]).toMatchObject({ submissionStatus: "pending" });
    const paymentMadeCall = enqueueMock.mock.calls.find(
      ([, m]: [unknown, { topic: string }]) => m.topic === EVENTS.paymentMade,
    );
    expect(paymentMadeCall).toBeDefined();

    // While the SFTP call is still pending, only ONE transaction has run --
    // the follow-up "record upload result" write has not started, because it
    // is gated on the upload actually finishing, not on the transaction that
    // already committed.
    expect(dbTransactionFn).toHaveBeenCalledTimes(1);
    expect(updatePfmsBatchMock).not.toHaveBeenCalled();

    // Now let the slow SFTP call finish successfully.
    sftp.resolve("/remote/path/NACH.txt");
    await settle();

    // A SECOND, separate transaction records the outcome -- the original
    // transaction was never reused/held open to wait for this.
    expect(dbTransactionFn).toHaveBeenCalledTimes(2);
    expect(events.slice(-2)).toEqual(["tx2:start", "tx2:commit"]);
    expect(updatePfmsBatchMock).toHaveBeenCalledTimes(1);
    expect(updatePfmsBatchMock.mock.calls[0][1]).toBe(insertPfmsBatchMock.mock.calls[0][1].id);
    expect(updatePfmsBatchMock.mock.calls[0][2]).toMatchObject({ submissionStatus: "file_sent" });
  });

  it("a failing SFTP upload does not roll back or block the already-committed batch/event/audit writes, and skips the follow-up write", async () => {
    uploadBankFileMock.mockRejectedValue(new Error("ECONNREFUSED: sftp.pfms.gov.in"));

    const q = await buildQueue();
    await q.publish(CONSUMED_EVENTS.eftInitiate, makeMsg(BASE_PAYLOAD));
    await settle();

    // The primary transaction committed regardless of the later SFTP failure.
    expect(insertPfmsBatchMock).toHaveBeenCalledTimes(1);
    expect(insertPfmsBatchMock.mock.calls[0][1]).toMatchObject({ submissionStatus: "pending" });
    expect(enqueueMock.mock.calls.some(([, m]: [unknown, { topic: string }]) => m.topic === EVENTS.paymentMade)).toBe(true);

    // No follow-up write happens for a failed upload -- the row is left
    // "pending" for manual/scheduled retry, not silently marked file_sent.
    expect(updatePfmsBatchMock).not.toHaveBeenCalled();
  });

  it("a duplicate message (idempotency ledger already has it) short-circuits before any NACH/SFTP work", async () => {
    markProcessedMock.mockResolvedValue(false);

    const q = await buildQueue();
    await q.publish(CONSUMED_EVENTS.eftInitiate, makeMsg(BASE_PAYLOAD));
    await settle();

    expect(insertPfmsBatchMock).not.toHaveBeenCalled();
    expect(uploadBankFileMock).not.toHaveBeenCalled();
    expect(updatePfmsBatchMock).not.toHaveBeenCalled();
  });
});
