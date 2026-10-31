/**
 * UAT bundle 10 (T6-01 / T6-02 / T6-03): every GL posting branch -- depreciation, disposal (incl. legacy auction),
 * payroll settlement and the generic path used by billing / revenue / refund -- answers a deterministic refusal with
 * finance.gl.rejected (journal id + producer reference + code) and dead-letters it (NonRetryableError).
 * Harness copied from tests/gl-unknown-account-code.test.ts (mocked-DB unit style).
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { randomUUID, createHash } from "node:crypto";
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
    for (const h of handlers) await h(msg);
    return msg.messageId;
  }
  subscribe(topic: string, handler: Handler): void {
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
  findHeadByCodeTxMock,
  findHeadByIdTxMock,
  hasChildHeadsTxMock,
  insertJournalMock,
  insertLedgerLineMock,
  insertJournalLineMock,
  findJournalByIdTxMock,
  findBudgetTxMock,
  incrementBudgetUtilisedGuardedMock,
  incrementBudgetUtilisedForcedMock,
  getPeriodStatusTxMock,
  nextVoucherNoMock,
} = vi.hoisted(() => {
  const _mockTx = { execute: vi.fn(async () => []) };
  const _dbTransactionFn = vi.fn(async (cb: (tx: unknown) => Promise<void>) => { await cb(_mockTx); });
  return {
    mockTx: _mockTx,
    dbTransactionFn: _dbTransactionFn as any,
    enqueueMock: vi.fn(async () => undefined) as any,
    markProcessedMock: vi.fn(async () => true) as any,
    findHeadByCodeTxMock: vi.fn() as any,
    findHeadByIdTxMock: vi.fn() as any,
    hasChildHeadsTxMock: vi.fn(async () => false) as any,
    insertJournalMock: vi.fn(async () => undefined) as any,
    insertLedgerLineMock: vi.fn(async () => undefined) as any,
    insertJournalLineMock: vi.fn(async () => undefined) as any,
    findJournalByIdTxMock: vi.fn(async () => null) as any,
    findBudgetTxMock: vi.fn(async () => null) as any,
    incrementBudgetUtilisedGuardedMock: vi.fn(async () => true) as any,
    incrementBudgetUtilisedForcedMock: vi.fn(async () => undefined) as any,
    getPeriodStatusTxMock: vi.fn(async () => "open") as any,
    nextVoucherNoMock: vi.fn(async () => ({ voucherNo: "JV/2025-26/000001", seq: 1 })) as any,
  };
});

vi.mock("../src/shared/db.js", () => ({
  scopedRead: dbTransactionFn,
  db: { transaction: dbTransactionFn },
}));

vi.mock("../src/shared/outbox.js", () => ({
  enqueue: (...args: any[]) => enqueueMock(...args),
  markProcessed: (...args: any[]) => markProcessedMock(...args),
}));

vi.mock("../src/shared/infra.js", () => ({
  cache: {
    invalidate: vi.fn(async () => undefined),
    invalidateResource: vi.fn(async () => undefined),
    makeKey: vi.fn((...parts: string[]) => parts.join(":")),
    put: vi.fn(async () => undefined),
  },
}));

vi.mock("../src/modules/gl/repo.js", () => ({
  insertJournal: (...args: any[]) => insertJournalMock(...args),
  insertLedgerLine: (...args: any[]) => insertLedgerLineMock(...args),
  insertJournalLine: (...args: any[]) => insertJournalLineMock(...args),
  findJournalByIdTx: (...args: any[]) => findJournalByIdTxMock(...args),
  findJournalById: vi.fn(async () => null),
  markJournalReversed: vi.fn(async () => undefined),
  resolveHeadId: vi.fn(async () => null),
}));

vi.mock("../src/modules/budget/repo.js", () => ({
  findHeadByCodeTx: (...args: any[]) => findHeadByCodeTxMock(...args),
  findHeadByIdTx: (...args: any[]) => findHeadByIdTxMock(...args),
  findBudgetTx: (...args: any[]) => findBudgetTxMock(...args),
  findSanctionByIdTx: vi.fn(async () => null),
  incrementSanctionUtilisedGuarded: vi.fn(async () => true),
  incrementBudgetUtilisedGuarded: (...args: any[]) => incrementBudgetUtilisedGuardedMock(...args),
  incrementBudgetUtilisedForced: (...args: any[]) => incrementBudgetUtilisedForcedMock(...args),
  hasChildHeadsTx: (...args: any[]) => hasChildHeadsTxMock(...args),
}));

vi.mock("../src/modules/period-close/repo.js", () => ({
  getPeriodStatusTx: (...args: any[]) => getPeriodStatusTxMock(...args),
}));

vi.mock("../src/modules/hoa/voucher.js", () => ({
  fyFromDate: vi.fn(() => "2025-26"),
  nextVoucherNo: (...args: any[]) => nextVoucherNoMock(...args),
}));

vi.mock("../src/modules/org-structure/domain.js", () => ({
  validateOrgAssignment: vi.fn(async () => undefined),
  validateOrgAssignmentTx: vi.fn(async () => undefined),
}));

vi.mock("../src/modules/gl/spine.js", () => ({
  deterministicId: (key: string) => {
    const h = createHash("sha256").update(key).digest("hex");
    return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20, 32)}`;
  },
}));

// ---------------------------------------------------------------------------
// Import the consumer AFTER mocks
// ---------------------------------------------------------------------------
import { registerGlConsumers, UnknownAccountCodeError } from "../src/modules/gl/consumer.js";
import { NonRetryableError } from "@civitasone/queue";
import * as observability from "@civitasone/observability";
import { COMMANDS } from "../src/topics.js";

const TENANT = "10000000-aaaa-4000-8000-000000000001";
const ACTOR = "20000000-bbbb-4000-8000-000000000001";

const EXPENSE_CODE = "5010"; // stands in for the "parent" head in test (1)
const BANK_CODE = "1100";

function fakeHeadUuid(code: string): string {
  return `00000000-0000-4000-8000-${code.padStart(12, "0")}`;
}

function makeMsg(payload: Record<string, unknown>) {
  return {
    messageId: randomUUID(),
    type: COMMANDS.journalPost,
    tenantId: TENANT,
    actorId: ACTOR,
    correlationId: `corr-${randomUUID()}`,
    schemaVersion: "1.0",
    payload,
  };
}

function journalPayload(overrides: Record<string, unknown> = {}, debitMinor = 150_000) {
  return {
    id: randomUUID(),
    tenantId: TENANT,
    voucherNo: "AUTO",
    type: "journal",
    postingDate: "2025-08-15",
    lines: [
      { accountCode: EXPENSE_CODE, debitMinor, creditMinor: 0 },
      { accountCode: BANK_CODE, debitMinor: 0, creditMinor: debitMinor },
    ],
    ...overrides,
  };
}

async function buildQueue(): Promise<TestMemoryQueue> {
  const q = new TestMemoryQueue();
  registerGlConsumers(q as any);
  await q.start();
  return q;
}

beforeEach(() => {
  vi.clearAllMocks();
  markProcessedMock.mockResolvedValue(true);
  findJournalByIdTxMock.mockResolvedValue(null);
  findHeadByCodeTxMock.mockImplementation(async (_tx: unknown, _tenantId: string, code: string) => ({
    id: fakeHeadUuid(code), code, name: `Head ${code}`, tenantId: TENANT,
  }));
  dbTransactionFn.mockImplementation(async (cb: (tx: unknown) => Promise<void>) => { await cb(mockTx); });
  hasChildHeadsTxMock.mockResolvedValue(false);
  getPeriodStatusTxMock.mockResolvedValue("open");
  findBudgetTxMock.mockResolvedValue(null);
  nextVoucherNoMock.mockImplementation(async () => ({ voucherNo: "JV/2025-26/000001", seq: 1 }));
});


// ---------------------------------------------------------------------------
// UAT bundle 10 -- F89 / F90: every GL posting branch answers a refusal with finance.gl.rejected
// ---------------------------------------------------------------------------
const ASSET = "30000000-cccc-4000-8000-000000000001";
const detId = (key: string) => {
  const h = createHash("sha256").update(key).digest("hex");
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20, 32)}`;
};
const rejectedPayloads = () => enqueueMock.mock.calls.filter((c: any[]) => c[1]?.topic === "finance.gl.rejected").map((c: any[]) => c[1].payload);
const missingHead = (missing: string) =>
  findHeadByCodeTxMock.mockImplementation(async (_tx: unknown, _tenantId: string, code: string) =>
    code === missing ? null : { id: fakeHeadUuid(code), code, name: `Head ${code}`, tenantId: TENANT });

describe("F89: depreciation branch reports a refusal (UAT T6-01)", () => {
  it("emits finance.gl.rejected with the entry's gl_ref, dead-letters, and leaves the message re-drivable", async () => {
    missingHead("1250");
    vi.spyOn(observability, "captureError").mockImplementation(() => undefined);
    const q = await buildQueue();
    const err = await q.publish(COMMANDS.journalPost, makeMsg({
      type: "depreciation", assetId: ASSET, period: "2026-09", depAmountMinor: "8333", currency: "INR", depBook: "company",
    })).then(() => null, (e: unknown) => e);
    expect(err).toBeInstanceOf(NonRetryableError);
    expect(insertJournalMock).not.toHaveBeenCalled();
    const ev = rejectedPayloads();
    expect(ev).toHaveLength(1);
    expect(ev[0]).toMatchObject({
      journalId: detId(`depreciation:${ASSET}:2026-09:company`), type: "depreciation", code: "UNKNOWN_ACCOUNT_CODE", accountCode: "1250",
      sourceRef: `dep:company:${ASSET}:2026-09`, source: { kind: "depreciation", assetId: ASSET, period: "2026-09", depBook: "company" },
    });
    // the rejection marks the inbox too (once in the rolled-back posting tx, once with the rejection), so a duplicate
    // delivery of the same message cannot emit a second rejection
    expect(markProcessedMock).toHaveBeenCalledTimes(2);
    markProcessedMock.mockResolvedValue(false); // the duplicate: already processed
    enqueueMock.mockClear();
    await q.publish(COMMANDS.journalPost, { ...makeMsg({ type: "depreciation", assetId: ASSET, period: "2026-09", depAmountMinor: "8333", depBook: "company" }) })
      .catch(() => undefined);
    expect(rejectedPayloads()).toHaveLength(0);
  });

  it("a transient failure in the depreciation branch is not reported and keeps its retry behaviour", async () => {
    getPeriodStatusTxMock.mockRejectedValue(new Error("connection terminated unexpectedly"));
    const q = await buildQueue();
    const err = await q.publish(COMMANDS.journalPost, makeMsg({
      type: "depreciation", assetId: ASSET, period: "2026-09", depAmountMinor: "8333", depBook: "statutory",
    })).then(() => null, (e: unknown) => e);
    expect(err).not.toBeInstanceOf(NonRetryableError);
    expect(rejectedPayloads()).toHaveLength(0);
  });
});

describe("F89: disposal branch reports a refusal (UAT T6-01)", () => {
  it("emits finance.gl.rejected for an asset_disposal journal whose head is missing", async () => {
    missingHead("1250");
    vi.spyOn(observability, "captureError").mockImplementation(() => undefined);
    const q = await buildQueue();
    const err = await q.publish(COMMANDS.journalPost, makeMsg({
      type: "asset_disposal", assetId: ASSET, acquisitionCost: "900000", accumulatedDep: "800000", proceeds: "0", gainLoss: "-100000", currency: "INR",
    })).then(() => null, (e: unknown) => e);
    expect(err).toBeInstanceOf(NonRetryableError);
    const ev = rejectedPayloads();
    expect(ev).toHaveLength(1);
    expect(ev[0]).toMatchObject({
      journalId: detId(`asset_disposal:${ASSET}`), type: "asset_disposal", code: "UNKNOWN_ACCOUNT_CODE",
      sourceRef: `asset_disposal:${ASSET}`, source: { kind: "asset_disposal", assetId: ASSET },
    });
    expect(markProcessedMock).toHaveBeenCalledTimes(1);
  });
});

describe("F90: an auction disposal posts (UAT T6-02)", () => {
  it("a legacy asset_disposal_auction message posts the balanced asset_disposal journal, gain derived from book value", async () => {
    const q = await buildQueue();
    await q.publish(COMMANDS.journalPost, makeMsg({
      type: "asset_disposal_auction", assetId: ASSET, acquisitionCost: "900000", accumulatedDep: "800000", proceeds: 350000, currency: "INR",
    }));
    expect(insertJournalMock).toHaveBeenCalledTimes(1);
    const j = insertJournalMock.mock.calls[0]![1];
    expect(j).toMatchObject({ id: detId(`asset_disposal:${ASSET}`), type: "asset_disposal" });
    const lines = j.lines as Array<{ accountCode: string; debitMinor: string; creditMinor: string }>;
    const dr = lines.reduce((s, l) => s + BigInt(l.debitMinor), 0n);
    const cr = lines.reduce((s, l) => s + BigInt(l.creditMinor), 0n);
    expect(dr).toBe(cr);
    expect(lines).toEqual(expect.arrayContaining([
      expect.objectContaining({ accountCode: "1100", debitMinor: "350000" }),
      expect.objectContaining({ accountCode: "4200", creditMinor: "250000" }),
    ]));
    expect(rejectedPayloads()).toHaveLength(0);
  });

  it("the asset_disposal shape asset-service now sends posts the same journal", async () => {
    const q = await buildQueue();
    await q.publish(COMMANDS.journalPost, makeMsg({
      type: "asset_disposal", assetId: ASSET, acquisitionCost: "900000", accumulatedDep: "800000", proceeds: "350000", gainLoss: "250000", currency: "INR",
    }));
    expect(insertJournalMock).toHaveBeenCalledTimes(1);
    expect(insertJournalMock.mock.calls[0]![1]).toMatchObject({ id: detId(`asset_disposal:${ASSET}`), type: "asset_disposal" });
  });
});

describe("F89: payroll settlement branch reports a posting refusal", () => {
  it("a closed period on payroll.run.disbursed emits finance.gl.rejected and dead-letters instead of retrying", async () => {
    getPeriodStatusTxMock.mockResolvedValue("hard_close");
    vi.spyOn(observability, "captureError").mockImplementation(() => undefined);
    const q = await buildQueue();
    const err = await q.publish("payroll.run.disbursed", { ...makeMsg({ runId: "40000000-dddd-4000-8000-000000000001", month: "2026-09", totalNetMinor: "500000" }), type: "payroll.run.disbursed" })
      .then(() => null, (e: unknown) => e);
    expect(err).toBeInstanceOf(NonRetryableError);
    const ev = rejectedPayloads();
    expect(ev).toHaveLength(1);
    expect(ev[0]).toMatchObject({
      journalId: detId("payroll_settlement:40000000-dddd-4000-8000-000000000001"), code: "PERIOD_CLOSED",
      sourceRef: "payroll_settlement:40000000-dddd-4000-8000-000000000001",
    });
  });
});

describe("F91: billing / revenue / refund journals (generic path) report a missing head", () => {
  it.each([
    ["billing_revenue_recognition", "1300"],
    ["billing_cash_receipt", "1300"],
    ["revenue_refund", "5200"],
  ])("a %s journal with head %s missing is rejected with the producer's journal id", async (type, code) => {
    missingHead(code);
    vi.spyOn(observability, "captureError").mockImplementation(() => undefined);
    const payload = journalPayload({ type, voucherNo: `T/${code}` });
    (payload.lines as Array<Record<string, unknown>>)[0]!.accountCode = code;
    const q = await buildQueue();
    const err = await q.publish(COMMANDS.journalPost, makeMsg(payload)).then(() => null, (e: unknown) => e);
    expect(err).toBeInstanceOf(NonRetryableError);
    expect(rejectedPayloads()).toEqual([expect.objectContaining({ journalId: payload.id, type, code: "UNKNOWN_ACCOUNT_CODE", accountCode: code })]);
  });
});
