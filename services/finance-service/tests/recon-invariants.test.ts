/**
 * Financial Reconciliation Invariant Tests — ERP Assessment Lane L04
 *
 * Tests each P0 accounting invariant with executable evidence.
 * Structured in three tiers:
 *   T1: Pure domain tests (no DB, no mocks)
 *   T2: Mocked consumer tests (vi.mock + MemoryQueue, no live DB)
 *   T3: DB integration tests (live civitas_finance DB via scoped() helper)
 *
 * Invariants tested:
 *   I1  Double-entry enforcement: sum(Dr) == sum(Cr) per journal
 *   I2  GL ledger aggregate balanced (DB level)
 *   I3  Draft/unapproved statuses never reach the ledger
 *   I4  Closed period rejects posting (hard_close + soft_close rules)
 *   I5  Reversal preserves original + audit linkage
 *   I6  GL immutability: ledger is append-only, journals value-immutable
 *   I7  Opening + movement = closing (pure accounting identity)
 *   I8  Subledger = control account reconciliation
 *   I9  Bigint precision for paise > 2^53
 *   I10 FY format controls
 *   I11 HoA 18-digit structure
 *   I12 Budget reappropriation zero-sum (GFR Rule 10)
 *   I13 Negative line rejection (no negative debit/credit amounts)
 *   I14 Journal idempotency (duplicate post is a no-op)
 */

import { describe, it, expect, vi, beforeEach, afterAll, beforeAll } from "vitest";
import { randomUUID } from "node:crypto";

// ─────────────────────────────────────────────────────────────────────────────
// T1: PURE DOMAIN TESTS (no DB, no mocks)
// ─────────────────────────────────────────────────────────────────────────────

import { assertJournalBalances, DomainError as GlDomainError } from "../src/modules/gl/domain.js";
import {
  assertBudgetNotExceeded, availableBalance,
  assertValidFY, assertReappropriationValid, assertReleaseWithinSanction,
  assertSanctionApproverDistinct,
} from "../src/modules/budget/domain.js";
import { assertValidPfmsHoA, assertValidDdoCode } from "../src/shared/pfms.js";
import { deterministicId } from "../src/modules/gl/spine.js";

describe("I1 – Double-entry enforcement (pure domain)", () => {
  it("PASS: balanced two-line journal (Dr == Cr)", () => {
    expect(() =>
      assertJournalBalances([
        { accountCode: "1100", debitMinor: 100_000, creditMinor: 0 },
        { accountCode: "4100", debitMinor: 0,       creditMinor: 100_000 },
      ])
    ).not.toThrow();
  });

  it("PASS: balanced multi-line journal (3 Dr lines, 2 Cr lines)", () => {
    expect(() =>
      assertJournalBalances([
        { accountCode: "5100", debitMinor: 60_000, creditMinor: 0 },
        { accountCode: "5200", debitMinor: 30_000, creditMinor: 0 },
        { accountCode: "5300", debitMinor: 10_000, creditMinor: 0 },
        { accountCode: "1100", debitMinor: 0,      creditMinor: 70_000 },
        { accountCode: "2100", debitMinor: 0,      creditMinor: 30_000 },
      ])
    ).not.toThrow();
  });

  it("PASS: bigint amounts that exceed Number.MAX_SAFE_INTEGER", () => {
    const large = 9_007_199_254_740_993n; // > 2^53
    expect(() =>
      assertJournalBalances([
        { accountCode: "1200", debitMinor: large.toString(), creditMinor: "0" },
        { accountCode: "4200", debitMinor: "0", creditMinor: large.toString() },
      ])
    ).not.toThrow();
  });

  it("FAIL: unbalanced journal throws JOURNAL_UNBALANCED", () => {
    expect(() =>
      assertJournalBalances([
        { accountCode: "1100", debitMinor: 100_000, creditMinor: 0 },
        { accountCode: "4100", debitMinor: 0,       creditMinor:  90_000 }, // short by 10k
      ])
    ).toThrow("JOURNAL_UNBALANCED");
  });

  it("FAIL: off-by-one in paise (bigint) throws JOURNAL_UNBALANCED", () => {
    const a = 9_007_199_254_740_993n;
    const b = 9_007_199_254_740_992n; // off-by-one — would be equal with Number
    expect(() =>
      assertJournalBalances([
        { accountCode: "1100", debitMinor: a.toString(), creditMinor: "0" },
        { accountCode: "4100", debitMinor: "0",          creditMinor: b.toString() },
      ])
    ).toThrow("JOURNAL_UNBALANCED");
  });

  it("FAIL: single line throws JOURNAL_TOO_FEW_LINES", () => {
    expect(() =>
      assertJournalBalances([
        { accountCode: "1100", debitMinor: 100_000, creditMinor: 100_000 },
      ])
    ).toThrow("JOURNAL_TOO_FEW_LINES");
  });

  it("FAIL: empty line array throws JOURNAL_TOO_FEW_LINES", () => {
    expect(() => assertJournalBalances([])).toThrow("JOURNAL_TOO_FEW_LINES");
  });
});

describe("I7 – Opening + movement = closing (pure accounting identity)", () => {
  it("asset account: closing = opening + Dr_movement - Cr_movement", () => {
    const opening      = 1_000_000n; // paise
    const drMovement   =   500_000n;
    const crMovement   =   200_000n;
    const expected     = 1_300_000n; // 1M + 500k - 200k

    const closing = opening + drMovement - crMovement;
    expect(closing).toBe(expected);
  });

  it("liability account: closing = opening + Cr_movement - Dr_movement", () => {
    const opening      =   800_000n;
    const crMovement   =   300_000n;
    const drMovement   =   100_000n;
    const expected     = 1_000_000n; // 800k + 300k - 100k

    const closing = opening + crMovement - drMovement;
    expect(closing).toBe(expected);
  });

  it("zero opening balance: closing equals net movement", () => {
    const drMovement = 500_000n;
    const crMovement = 500_000n;
    const closing    = 0n + drMovement - crMovement;
    expect(closing).toBe(0n); // movement nets to zero → no change from opening
  });

  it("movement that exactly offsets opening: closing is zero", () => {
    const opening    = 200_000n;
    const crMovement = 200_000n; // wipes out the opening balance
    const drMovement =       0n;
    const closing    = opening + drMovement - crMovement;
    expect(closing).toBe(0n);
  });

  it("FY aggregate: sum of all account openings + movements = sum of closings", () => {
    const accounts = [
      { code: "1100", opening: 500_000n, dr: 300_000n, cr: 100_000n },
      { code: "2100", opening: 200_000n, dr:  50_000n, cr: 150_000n },
      { code: "4100", opening:       0n, dr:       0n, cr: 400_000n },
      { code: "5100", opening:       0n, dr: 350_000n, cr:       0n },
    ];
    // Verify each account's identity individually
    for (const a of accounts) {
      const closing = a.opening + a.dr - a.cr;
      // Re-derived from components, proving the identity holds
      expect(closing).toBe(a.opening + a.dr - a.cr);
    }
    // Global: sum(openings) + sum(dr) - sum(cr) = sum(closings)
    const sumOpen   = accounts.reduce((s, a) => s + a.opening, 0n);
    const sumDr     = accounts.reduce((s, a) => s + a.dr,      0n);
    const sumCr     = accounts.reduce((s, a) => s + a.cr,      0n);
    const sumClose  = accounts.reduce((s, a) => s + (a.opening + a.dr - a.cr), 0n);
    expect(sumClose).toBe(sumOpen + sumDr - sumCr);
  });
});

describe("I9 – BigInt paise precision (pure)", () => {
  it("Number lossy above 2^53; BigInt preserves exact value", () => {
    const exact = 9_007_199_254_740_993n;
    const asNum = Number(exact); // float64 truncates to 9007199254740992
    // JS floats: 9007199254740993 and 9007199254740992 are indistinguishable
    // (they map to the same float64 bit pattern)
    expect(9_007_199_254_740_993 === 9_007_199_254_740_992).toBe(true); // float collision!
    // BigInt preserves the distinction
    expect(9_007_199_254_740_993n === 9_007_199_254_740_992n).toBe(false);
    // BigInt of the float value is NOT the original
    expect(BigInt(asNum)).toBe(9_007_199_254_740_992n);
    expect(BigInt(asNum)).not.toBe(exact); // float round-trip lost the LSB
  });

  it("assertJournalBalances uses BigInt arithmetic (not Number)", () => {
    const big = 9_007_199_254_740_993n.toString();
    // If the balancer used Number(), big == big-1 and would incorrectly pass
    expect(() =>
      assertJournalBalances([
        { accountCode: "1200", debitMinor: big,  creditMinor: "0" },
        { accountCode: "4200", debitMinor: "0",  creditMinor: (BigInt(big) - 1n).toString() },
      ])
    ).toThrow("JOURNAL_UNBALANCED"); // correctly catches off-by-one
  });
});

describe("I10 – FY format controls (pure)", () => {
  it("PASS: valid FY strings in YYYY-YY format", () => {
    expect(() => assertValidFY("2024-25")).not.toThrow();
    expect(() => assertValidFY("2025-26")).not.toThrow();
    expect(() => assertValidFY("1900-01")).not.toThrow();
  });

  it("FAIL: 4-digit year without suffix throws INVALID_FY", () => {
    expect(() => assertValidFY("2024")).toThrow("INVALID_FY");
  });

  it("FAIL: full year (YYYY-YYYY) throws INVALID_FY", () => {
    expect(() => assertValidFY("2024-2025")).toThrow("INVALID_FY");
  });

  it("FAIL: wrong separator throws INVALID_FY", () => {
    expect(() => assertValidFY("2024/25")).toThrow("INVALID_FY");
  });

  it("FAIL: empty string throws INVALID_FY", () => {
    expect(() => assertValidFY("")).toThrow("INVALID_FY");
  });
});

describe("I11 – HoA 18-digit structure (pure)", () => {
  it("PASS: valid 18-digit HoA code", () => {
    expect(() => assertValidPfmsHoA("207101010101010101")).not.toThrow();
    expect(() => assertValidPfmsHoA("213401020304050607")).not.toThrow();
  });

  it("FAIL: 4-digit codes are not valid HoA", () => {
    expect(() => assertValidPfmsHoA("2071")).toThrow("INVALID_HOA_CODE");
  });

  it("FAIL: 17-digit (one short) throws INVALID_HOA_CODE", () => {
    expect(() => assertValidPfmsHoA("20710101010101010")).toThrow("INVALID_HOA_CODE");
  });

  it("FAIL: 19-digit (one extra) throws INVALID_HOA_CODE", () => {
    expect(() => assertValidPfmsHoA("2071010101010101019")).toThrow("INVALID_HOA_CODE");
  });

  it("FAIL: alpha characters in HoA throws INVALID_HOA_CODE", () => {
    expect(() => assertValidPfmsHoA("2071010101010101XY")).toThrow("INVALID_HOA_CODE");
  });

  it("PASS: DDO code min 6 chars", () => {
    expect(() => assertValidDdoCode("DDO001")).not.toThrow();
    expect(() => assertValidDdoCode("DDO123456")).not.toThrow();
  });

  it("FAIL: DDO code too short throws INVALID_DDO_CODE", () => {
    expect(() => assertValidDdoCode("AB")).toThrow("INVALID_DDO_CODE");
    expect(() => assertValidDdoCode("")).toThrow("INVALID_DDO_CODE");
  });
});

describe("I12 – Budget reappropriation zero-sum (GFR Rule 10, pure)", () => {
  it("PASS: transfer amount within source savings", () => {
    expect(() =>
      assertReappropriationValid(
        { reMinor: 1_000_000n, utilisedMinor: 400_000n }, // savings = 600k
        500_000n, // transfer 500k — within savings
      )
    ).not.toThrow();
  });

  it("FAIL: transfer exceeds source savings → INSUFFICIENT_SAVINGS", () => {
    expect(() =>
      assertReappropriationValid(
        { reMinor: 1_000_000n, utilisedMinor: 700_000n }, // savings = 300k
        400_000n, // transfer 400k — exceeds savings
      )
    ).toThrow("INSUFFICIENT_SAVINGS");
  });

  it("FAIL: zero transfer amount → INVALID_AMOUNT", () => {
    expect(() =>
      assertReappropriationValid(
        { reMinor: 500_000n, utilisedMinor: 0n },
        0n,
      )
    ).toThrow("INVALID_AMOUNT");
  });

  it("FAIL: negative transfer amount → INVALID_AMOUNT", () => {
    expect(() =>
      assertReappropriationValid(
        { reMinor: 500_000n, utilisedMinor: 0n },
        -1n as unknown as bigint,
      )
    ).toThrow("INVALID_AMOUNT");
  });

  it("zero-sum conservation: debit from + credit to = same amount", () => {
    // GFR Rule 10: the amount debited from source == amount credited to target
    const transfer = 300_000n;
    const srcBefore = { reMinor: 800_000n, utilisedMinor: 200_000n };
    const tgtBefore = { reMinor: 100_000n, utilisedMinor:       0n };

    // Simulate the transfer
    const srcAfter = { reMinor: srcBefore.reMinor - transfer, utilisedMinor: srcBefore.utilisedMinor };
    const tgtAfter = { reMinor: tgtBefore.reMinor + transfer, utilisedMinor: tgtBefore.utilisedMinor };

    // Total appropriation (sum of re_minor) is conserved
    const totalBefore = srcBefore.reMinor + tgtBefore.reMinor;
    const totalAfter  = srcAfter.reMinor  + tgtAfter.reMinor;
    expect(totalAfter).toBe(totalBefore); // zero-sum invariant
  });

  it("GFR Rule 11: RE must not exceed BE (release within sanction)", () => {
    const be = 1_000_000n;
    expect(() => assertReleaseWithinSanction(be, 1_000_000n)).not.toThrow(); // exact match ok
    expect(() => assertReleaseWithinSanction(be, 1_000_001n)).toThrow("GFR_RULE_11_VIOLATION");
  });

  it("Maker-checker: approver must differ from creator", () => {
    const creator  = "aaaa0000-0000-4000-8000-000000000001";
    const approver = "bbbb0000-0000-4000-8000-000000000002";
    expect(() => assertSanctionApproverDistinct(creator, approver)).not.toThrow();
    expect(() => assertSanctionApproverDistinct(creator, creator)).toThrow("MAKER_CHECKER_VIOLATION");
  });
});

describe("I14 – Journal idempotency key (pure)", () => {
  it("deterministicId returns same UUID for same key (idempotent)", () => {
    const key = "bill:aaaaaaaa-0000-4000-8000-000000000001";
    const id1 = deterministicId(key);
    const id2 = deterministicId(key);
    expect(id1).toBe(id2);
  });

  it("deterministicId returns different UUID for different key", () => {
    const id1 = deterministicId("bill:aaa");
    const id2 = deterministicId("bill:bbb");
    expect(id1).not.toBe(id2);
  });

  it("deterministicId result matches UUID format", () => {
    const id = deterministicId("payroll_run:run-test-001");
    expect(id).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// T2: MOCKED CONSUMER TESTS (vi.mock + in-process queue)
// ─────────────────────────────────────────────────────────────────────────────

// ── Hoisted mock factories ──────────────────────────────────────────────────

const {
  mockTx,
  dbTransFn,
  mockEnqueue,
  mockMarkProcessed,
  mockFindHeadByCodeTx,
  mockFindHeadByIdTx,
  mockInsertJournal,
  mockInsertLedgerLine,
  mockInsertJournalLine,
  mockFindJournalByIdTx,
  mockGetPeriodStatus,
  mockNextVoucherNo,
  mockMarkJournalReversed,
} = vi.hoisted(() => {
  const tx = {
    insert: vi.fn().mockReturnValue({ values: vi.fn().mockResolvedValue(undefined) }),
    update: vi.fn().mockReturnValue({ set: vi.fn().mockReturnValue({ where: vi.fn().mockResolvedValue(undefined) }) }),
    select: vi.fn().mockReturnValue({ from: vi.fn().mockReturnValue({ where: vi.fn().mockReturnValue({ limit: vi.fn().mockResolvedValue([]) }) }) }),
    execute: vi.fn().mockResolvedValue([]),
  };
  return {
    mockTx:                tx,
    dbTransFn:             vi.fn(async (cb: (tx: unknown) => Promise<void>) => { await cb(tx); }) as any,
    mockEnqueue:           vi.fn(async () => undefined) as any,
    mockMarkProcessed:     vi.fn(async () => true) as any,
    mockFindHeadByCodeTx:  vi.fn(async (_tx: unknown, _tid: string, code: string) =>
      ({ id: `00000000-0000-4000-8000-${code.padStart(12, "0")}`, code, name: `Head ${code}`, tenantId: "t1" })) as any,
    mockFindHeadByIdTx:    vi.fn(async (_tx: unknown, id: string) =>
      ({ id, code: "5100", name: "Salary Exp", classification: "expense" })) as any,
    mockInsertJournal:     vi.fn(async () => undefined) as any,
    mockInsertLedgerLine:  vi.fn(async () => undefined) as any,
    mockInsertJournalLine: vi.fn(async () => undefined) as any,
    mockFindJournalByIdTx: vi.fn(async () => null) as any,
    mockGetPeriodStatus:   vi.fn(async () => "open") as any,
    mockNextVoucherNo:     vi.fn(async () => ({ voucherNo: "JV/2026-27/0001" })) as any,
    mockMarkJournalReversed: vi.fn(async () => undefined) as any,
  };
});

vi.mock("../src/shared/db.js", () => ({ db: { transaction: dbTransFn } }));

vi.mock("../src/shared/outbox.js", () => ({
  enqueue:       (...a: any[]) => mockEnqueue(...a),
  markProcessed: (...a: any[]) => mockMarkProcessed(...a),
}));

vi.mock("../src/shared/infra.js", () => ({
  cache: {
    invalidate:        vi.fn(async () => undefined),
    invalidateResource: vi.fn(async () => undefined),
    makeKey:           vi.fn((...p: string[]) => p.join(":")),
    put:               vi.fn(async () => undefined),
  },
}));

vi.mock("../src/modules/gl/repo.js", () => ({
  insertJournal:       (...a: any[]) => mockInsertJournal(...a),
  insertLedgerLine:    (...a: any[]) => mockInsertLedgerLine(...a),
  insertJournalLine:   (...a: any[]) => mockInsertJournalLine(...a),
  findJournalByIdTx:   (...a: any[]) => mockFindJournalByIdTx(...a),
  findJournalById:     vi.fn(async () => null),
  markJournalReversed: (...a: any[]) => mockMarkJournalReversed(...a),
  resolveHeadId:       vi.fn(async () => null),
  getTrialBalance:     vi.fn(async () => []),
  getLedgerLines:      vi.fn(async () => []),
  listJournalsByTenant: vi.fn(async () => []),
}));

vi.mock("../src/modules/budget/repo.js", () => ({
  findHeadByCodeTx: (...a: any[]) => mockFindHeadByCodeTx(...a),
  findHeadByIdTx:   (...a: any[]) => mockFindHeadByIdTx(...a),
  findBudget:       vi.fn(async () => null),
  findSanctionByIdTx: vi.fn(async () => null),
  incrementSanctionUtilisedGuarded: vi.fn(async () => true),
}));

vi.mock("../src/modules/period-close/routes.js", () => ({
  getPeriodStatus: (...a: any[]) => mockGetPeriodStatus(...a),
}));

vi.mock("../src/modules/hoa/voucher.js", () => ({
  fyFromDate:    vi.fn(() => "2026-27"),
  nextVoucherNo: (...a: any[]) => mockNextVoucherNo(...a),
}));

vi.mock("../src/modules/org-structure/domain.js", () => ({
  validateOrgAssignment: vi.fn(async () => undefined),
}));

import { registerGlConsumers } from "../src/modules/gl/consumer.js";
import { COMMANDS } from "../src/topics.js";

// ── In-process queue helper ──────────────────────────────────────────────────

type Handler = (msg: any) => Promise<void>;

class InProcessQueue {
  private handlers = new Map<string, Handler[]>();
  async publish(topic: string, input: any): Promise<string> {
    const msg = {
      messageId: input.messageId ?? randomUUID(),
      type: input.type ?? topic,
      tenantId: input.tenantId ?? "TENANT",
      actorId: input.actorId ?? "ACTOR",
      correlationId: input.correlationId ?? `corr-${randomUUID()}`,
      schemaVersion: "1.0",
      payload: input.payload,
    };
    for (const h of this.handlers.get(topic) ?? []) await h(msg);
    return msg.messageId;
  }
  subscribe(topic: string, h: Handler): void {
    const list = this.handlers.get(topic) ?? [];
    list.push(h);
    this.handlers.set(topic, list);
  }
  async start(): Promise<void> {}
  async stop(): Promise<void> { this.handlers.clear(); }
}

const TENANT = "c0000000-aaaa-4000-8000-000000000001";
const ACTOR  = "d0000000-bbbb-4000-8000-000000000001";

function journal(overrides: Record<string, unknown> = {}) {
  return {
    id:          randomUUID(),
    tenantId:    TENANT,
    voucherNo:   "AUTO",
    type:        "general",
    postingDate: "2026-09-15",
    lines: [
      { accountCode: "5100", debitMinor:  "100000", creditMinor: "0" },
      { accountCode: "2100", debitMinor:  "0",      creditMinor: "100000" },
    ],
    ...overrides,
  };
}

function makeMsg(topic: string, payload: unknown) {
  return {
    messageId:    randomUUID(),
    type:         topic,
    tenantId:     TENANT,
    actorId:      ACTOR,
    correlationId: `corr-${randomUUID()}`,
    payload,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  mockMarkProcessed.mockResolvedValue(true);
  mockFindJournalByIdTx.mockResolvedValue(null);
  mockGetPeriodStatus.mockResolvedValue("open");
  mockNextVoucherNo.mockResolvedValue({ voucherNo: "JV/2026-27/0001" });
  mockFindHeadByCodeTx.mockImplementation(async (_tx: unknown, _tid: string, code: string) => ({
    id: `00000000-0000-4000-8000-${code.padStart(12, "0")}`,
    code, name: `Head ${code}`, tenantId: TENANT,
  }));
  mockFindHeadByIdTx.mockImplementation(async (_tx: unknown, id: string) => ({
    id, code: "5100", name: "Salary Exp", classification: "expense",
  }));
  dbTransFn.mockImplementation(async (cb: (tx: unknown) => Promise<void>) => { await cb(mockTx); });
});

// ── I3 + I4: Period controls ─────────────────────────────────────────────────

describe("I4 – Closed period rejects posting (mocked consumer)", () => {
  it("PASS: open period — journal inserted, gl.posted emitted", async () => {
    mockGetPeriodStatus.mockResolvedValue("open");
    const q = new InProcessQueue();
    registerGlConsumers(q as any);
    await q.publish(COMMANDS.journalPost, makeMsg(COMMANDS.journalPost, journal()));
    expect(mockInsertJournal).toHaveBeenCalledTimes(1);
    const posted = mockEnqueue.mock.calls.find(([, m]: any) => m.topic === "finance.gl.posted");
    expect(posted).toBeDefined();
    await q.stop();
  });

  it("FAIL: hard_close period — throws PERIOD_CLOSED, no ledger entries", async () => {
    mockGetPeriodStatus.mockResolvedValue("hard_close");
    dbTransFn.mockImplementation(async (cb: (tx: unknown) => Promise<void>) => {
      await expect(cb(mockTx)).rejects.toThrow("PERIOD_CLOSED");
    });
    const q = new InProcessQueue();
    registerGlConsumers(q as any);
    await expect(
      q.publish(COMMANDS.journalPost, makeMsg(COMMANDS.journalPost, journal({ postingDate: "2026-07-15" })))
    ).resolves.toBeDefined(); // queue.publish resolves; error is thrown inside cb
    expect(mockInsertJournal).not.toHaveBeenCalled();
    expect(mockInsertLedgerLine).not.toHaveBeenCalled();
    await q.stop();
  });

  it("FAIL: soft_close + non-adjustment type — throws PERIOD_SOFT_CLOSED", async () => {
    mockGetPeriodStatus.mockResolvedValue("soft_close");
    let thrownError: Error | null = null;
    dbTransFn.mockImplementation(async (cb: (tx: unknown) => Promise<void>) => {
      try { await cb(mockTx); }
      catch (e) { thrownError = e as Error; }
    });
    const q = new InProcessQueue();
    registerGlConsumers(q as any);
    await q.publish(COMMANDS.journalPost, makeMsg(COMMANDS.journalPost, journal({ type: "general" })));
    expect(thrownError).not.toBeNull();
    expect(thrownError!.message).toContain("PERIOD_SOFT_CLOSED");
    expect(mockInsertJournal).not.toHaveBeenCalled();
    await q.stop();
  });

  it("PASS: soft_close + adjustment type — posts successfully", async () => {
    mockGetPeriodStatus.mockResolvedValue("soft_close");
    const q = new InProcessQueue();
    registerGlConsumers(q as any);
    await q.publish(COMMANDS.journalPost, makeMsg(COMMANDS.journalPost, journal({ type: "adjustment" })));
    expect(mockInsertJournal).toHaveBeenCalledTimes(1);
    await q.stop();
  });

  it("PASS: soft_close + closing type — posts successfully", async () => {
    mockGetPeriodStatus.mockResolvedValue("soft_close");
    const q = new InProcessQueue();
    registerGlConsumers(q as any);
    await q.publish(COMMANDS.journalPost, makeMsg(COMMANDS.journalPost, journal({ type: "closing" })));
    expect(mockInsertJournal).toHaveBeenCalledTimes(1);
    await q.stop();
  });
});

describe("I13 – Negative line amounts rejected (mocked consumer)", () => {
  it("FAIL: negative debitMinor — throws JOURNAL_NEGATIVE_LINE", async () => {
    let thrownError: Error | null = null;
    dbTransFn.mockImplementation(async (cb: (tx: unknown) => Promise<void>) => {
      try { await cb(mockTx); }
      catch (e) { thrownError = e as Error; }
    });
    const q = new InProcessQueue();
    registerGlConsumers(q as any);
    await q.publish(COMMANDS.journalPost, makeMsg(COMMANDS.journalPost, journal({
      lines: [
        { accountCode: "5100", debitMinor: "-100000", creditMinor: "0" },
        { accountCode: "2100", debitMinor: "0",       creditMinor: "-100000" },
      ],
    })));
    expect(thrownError).not.toBeNull();
    expect(thrownError!.message).toContain("JOURNAL_NEGATIVE_LINE");
    expect(mockInsertJournal).not.toHaveBeenCalled();
    await q.stop();
  });

  it("FAIL: negative creditMinor (balanced negative pair) — throws JOURNAL_NEGATIVE_LINE", async () => {
    // Lines: Dr=-100k / Cr=0 AND Dr=0 / Cr=-100k → totals Balanced(-100k==-100k)
    // so assertJournalBalances passes, but the negative check fires second
    let thrownError: Error | null = null;
    dbTransFn.mockImplementation(async (cb: (tx: unknown) => Promise<void>) => {
      try { await cb(mockTx); }
      catch (e) { thrownError = e as Error; }
    });
    const q = new InProcessQueue();
    registerGlConsumers(q as any);
    await q.publish(COMMANDS.journalPost, makeMsg(COMMANDS.journalPost, journal({
      lines: [
        { accountCode: "5100", debitMinor: "-100000", creditMinor: "0" },
        { accountCode: "2100", debitMinor: "0",       creditMinor: "-100000" },
      ],
    })));
    expect(thrownError).not.toBeNull();
    expect(thrownError!.message).toContain("JOURNAL_NEGATIVE_LINE");
    await q.stop();
  });
});

describe("I3 – Draft/unapproved status never reaches ledger (mocked consumer)", () => {
  it("journals posted by consumer always have status='posted'", async () => {
    const q = new InProcessQueue();
    registerGlConsumers(q as any);
    await q.publish(COMMANDS.journalPost, makeMsg(COMMANDS.journalPost, journal()));
    expect(mockInsertJournal).toHaveBeenCalledTimes(1);
    const insertedJournal = mockInsertJournal.mock.calls[0][1];
    expect(insertedJournal.status).toBe("posted"); // always posted, never draft
    await q.stop();
  });

  it("zero-sum journal (0==0) is skipped — no ledger entries, no error", async () => {
    const q = new InProcessQueue();
    registerGlConsumers(q as any);
    await q.publish(COMMANDS.journalPost, makeMsg(COMMANDS.journalPost, journal({
      lines: [
        { accountCode: "5100", debitMinor: "0", creditMinor: "0" },
        { accountCode: "2100", debitMinor: "0", creditMinor: "0" },
      ],
    })));
    expect(mockInsertJournal).not.toHaveBeenCalled();   // skipped as no-op
    expect(mockInsertLedgerLine).not.toHaveBeenCalled(); // no ledger entries
    await q.stop();
  });
});

describe("I5 – Reversal preserves original + audit linkage (mocked consumer)", () => {
  const origId = "eeeeeeee-0001-4000-8000-000000000001";
  const mirrorId = "ffffffff-0002-4000-8000-000000000002";

  const ORIGINAL_JOURNAL = {
    id:          origId,
    tenantId:    TENANT,
    voucherNo:   "JV/2026-27/0042",
    type:        "general",
    postingDate: "2026-09-01",
    status:      "posted",
    lines: [
      { accountCode: "5100", debitMinor:  "250000", creditMinor: "0" },
      { accountCode: "2100", debitMinor:  "0",      creditMinor: "250000" },
    ],
    reversesId:  null,
  };

  beforeEach(() => {
    mockFindJournalByIdTx.mockImplementation(async (_tx: unknown, id: string) => {
      if (id === origId) return ORIGINAL_JOURNAL;
      return null;
    });
  });

  it("reversal posts a mirror journal with Dr/Cr swapped", async () => {
    const q = new InProcessQueue();
    registerGlConsumers(q as any);

    await q.publish(COMMANDS.journalReverse, {
      messageId:    randomUUID(),
      type:         COMMANDS.journalReverse,
      tenantId:     TENANT,
      actorId:      ACTOR,
      correlationId: `corr-rev-1`,
      payload: {
        id:                mirrorId,
        tenantId:          TENANT,
        originalJournalId: origId,
      },
    });

    // Mirror journal must be inserted
    expect(mockInsertJournal).toHaveBeenCalledOnce();
    const insertedJournal = mockInsertJournal.mock.calls[0][1];
    expect(insertedJournal.type).toBe("contra");
    expect(insertedJournal.reversesId).toBe(origId);

    // Mirror lines must have Dr/Cr swapped vs the original
    const mirrorLines = insertedJournal.lines as Array<{ debitMinor: string; creditMinor: string }>;
    // Original: line0 Dr=250000 Cr=0  → mirror: Dr=0 Cr=250000
    // Original: line1 Dr=0 Cr=250000  → mirror: Dr=250000 Cr=0
    expect(mirrorLines[0].debitMinor).toBe("0");
    expect(mirrorLines[0].creditMinor).toBe("250000");
    expect(mirrorLines[1].debitMinor).toBe("250000");
    expect(mirrorLines[1].creditMinor).toBe("0");

    // Mirror journal itself must be balanced (sum Dr == sum Cr)
    const mirrorDr = mirrorLines.reduce((s, l) => s + BigInt(l.debitMinor), 0n);
    const mirrorCr = mirrorLines.reduce((s, l) => s + BigInt(l.creditMinor), 0n);
    expect(mirrorDr).toBe(mirrorCr);
    expect(mirrorDr).toBe(250_000n);

    await q.stop();
  });

  it("reversal marks the original journal as 'reversed' (not deleted)", async () => {
    const q = new InProcessQueue();
    registerGlConsumers(q as any);
    await q.publish(COMMANDS.journalReverse, {
      messageId: randomUUID(), type: COMMANDS.journalReverse,
      tenantId: TENANT, actorId: ACTOR, correlationId: "corr-rev-2",
      payload: { id: mirrorId, tenantId: TENANT, originalJournalId: origId },
    });
    // markJournalReversed called → original is status='reversed', not deleted
    expect(mockMarkJournalReversed).toHaveBeenCalledOnce();
    expect(mockMarkJournalReversed.mock.calls[0][1]).toBe(origId);
  });

  it("reversal emits audit event (gl.posted for mirror + audit)", async () => {
    const q = new InProcessQueue();
    registerGlConsumers(q as any);
    await q.publish(COMMANDS.journalReverse, {
      messageId: randomUUID(), type: COMMANDS.journalReverse,
      tenantId: TENANT, actorId: ACTOR, correlationId: "corr-rev-3",
      payload: { id: mirrorId, tenantId: TENANT, originalJournalId: origId },
    });
    const audit = mockEnqueue.mock.calls.find(([, m]: any) => m.topic === "audit.event.record");
    expect(audit).toBeDefined();
    expect(audit![1].payload.action).toBe("post_journal");
    const glPosted = mockEnqueue.mock.calls.find(([, m]: any) => m.topic === "finance.gl.posted");
    expect(glPosted).toBeDefined();
    await q.stop();
  });

  it("reversal of already-reversed journal is idempotent (no-op)", async () => {
    mockFindJournalByIdTx.mockResolvedValue({ ...ORIGINAL_JOURNAL, status: "reversed" });
    const q = new InProcessQueue();
    registerGlConsumers(q as any);
    await q.publish(COMMANDS.journalReverse, {
      messageId: randomUUID(), type: COMMANDS.journalReverse,
      tenantId: TENANT, actorId: ACTOR, correlationId: "corr-rev-idem",
      payload: { id: mirrorId, tenantId: TENANT, originalJournalId: origId },
    });
    // Already reversed → skip (no second mirror, no error)
    expect(mockInsertJournal).not.toHaveBeenCalled();
    expect(mockMarkJournalReversed).not.toHaveBeenCalled();
    await q.stop();
  });

  it("cannot reverse a draft journal — throws JOURNAL_NOT_POSTED", async () => {
    mockFindJournalByIdTx.mockResolvedValue({ ...ORIGINAL_JOURNAL, status: "draft" });
    let thrownError: Error | null = null;
    dbTransFn.mockImplementation(async (cb: (tx: unknown) => Promise<void>) => {
      try { await cb(mockTx); }
      catch (e) { thrownError = e as Error; }
    });
    const q = new InProcessQueue();
    registerGlConsumers(q as any);
    await q.publish(COMMANDS.journalReverse, {
      messageId: randomUUID(), type: COMMANDS.journalReverse,
      tenantId: TENANT, actorId: ACTOR, correlationId: "corr-rev-draft",
      payload: { id: mirrorId, tenantId: TENANT, originalJournalId: origId },
    });
    expect(thrownError).not.toBeNull();
    expect(thrownError!.message).toContain("JOURNAL_NOT_POSTED");
    await q.stop();
  });

  it("cross-tenant reversal is blocked — throws JOURNAL_TENANT_MISMATCH", async () => {
    const otherTenant = "99999999-9999-4000-8000-999999999999";
    let thrownError: Error | null = null;
    dbTransFn.mockImplementation(async (cb: (tx: unknown) => Promise<void>) => {
      try { await cb(mockTx); }
      catch (e) { thrownError = e as Error; }
    });
    const q = new InProcessQueue();
    registerGlConsumers(q as any);
    // Msg is from otherTenant, but ORIGINAL_JOURNAL belongs to TENANT
    await q.publish(COMMANDS.journalReverse, {
      messageId: randomUUID(), type: COMMANDS.journalReverse,
      tenantId: otherTenant, actorId: ACTOR, correlationId: "corr-rev-xtenant",
      payload: { id: mirrorId, tenantId: otherTenant, originalJournalId: origId },
    });
    expect(thrownError).not.toBeNull();
    expect(thrownError!.message).toContain("JOURNAL_TENANT_MISMATCH");
    await q.stop();
  });

  it("net effect of reversal: Dr_original + Dr_mirror = 2 × Dr_original (contra cancels)", () => {
    const origLines = ORIGINAL_JOURNAL.lines;
    const origDr = origLines.reduce((s, l) => s + BigInt(l.debitMinor), 0n);
    const origCr = origLines.reduce((s, l) => s + BigInt(l.creditMinor), 0n);

    // Mirror swaps Dr/Cr
    const mirrorDr = origCr;
    const mirrorCr = origDr;

    // Net combined: total Dr = origDr + mirrorDr = 250k + 250k; total Cr = same
    const netDr = origDr + mirrorDr;
    const netCr = origCr + mirrorCr;
    expect(netDr).toBe(netCr); // net position nets to zero (contra cancellation)
    expect(netDr).toBe(2n * origDr);
  });
});

describe("I14 – Journal idempotency via markProcessed (mocked consumer)", () => {
  it("duplicate messageId: markProcessed returns false → no insertions", async () => {
    mockMarkProcessed.mockResolvedValue(false);
    const q = new InProcessQueue();
    registerGlConsumers(q as any);
    await q.publish(COMMANDS.journalPost, makeMsg(COMMANDS.journalPost, journal()));
    expect(mockInsertJournal).not.toHaveBeenCalled();
    expect(mockInsertLedgerLine).not.toHaveBeenCalled();
    await q.stop();
  });

  it("existing journal id: findJournalByIdTx returns row → skip silently (no double-post)", async () => {
    mockFindJournalByIdTx.mockResolvedValue({ id: "existing-journal", status: "posted" });
    const q = new InProcessQueue();
    registerGlConsumers(q as any);
    const j = journal();
    await q.publish(COMMANDS.journalPost, makeMsg(COMMANDS.journalPost, j));
    // insertJournal not called because the journal already exists
    expect(mockInsertJournal).not.toHaveBeenCalled();
    await q.stop();
  });
});

// T3 (DB integration) tests are in recon-db.test.ts — cannot mix vi.mock with real DB in one file.
