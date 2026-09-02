/**
 * F3 GPF consumer — unit tests.
 *
 * Regression cover for the "generated F3 leftover consumer" bug class first
 * found in `leave_policy_admin_routes__0`: the generator that stubbed each route
 * down to a bare `publishF3Write(...)` dropped the preamble that fetched the
 * account and computed the derived money values, so all three cases referenced
 * undefined names (`acctId`, `opening`, `acct`, `amount`, `delta`, `entryType`,
 * `ledgerId`, `ratePct`) and threw a ReferenceError. Because the routes answer
 * 2xx as soon as the message is queued, every GPF account opening, ledger
 * posting and interest accrual was a fake success.
 *
 * All three ops are now fixed and asserted below. `gpf_routes__1` (subscription
 * / advance / withdrawal / refund) used to be DELIBERATELY left broken because
 * the four routes that share it published byte-identical payloads with no way
 * to tell which op — or which credit/debit direction — the message represented.
 * routes.ts now forwards `entryType`/`sign` explicitly, so this file covers all
 * four entry types and asserts the correct sign lands for each, plus the
 * INSUFFICIENT_BALANCE guard.
 *
 * Follows the MemoryQueue + mocked db.transaction pattern of
 * ../leave/f3-consumer.test.ts.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { randomUUID } from "node:crypto";
import { MemoryQueue } from "@civitasone/queue";

const { mockTx, R } = vi.hoisted(() => ({
  mockTx: { __tx: true },
  R: {
    insertAccount: vi.fn(async (..._a: any[]): Promise<any> => undefined),
    insertLedger: vi.fn(async (..._a: any[]): Promise<any> => undefined),
    lockedBalance: vi.fn(async (..._a: any[]): Promise<any> => 0n),
    bumpAccountVersion: vi.fn(async (..._a: any[]): Promise<any> => undefined),
    findAccountByEmployee: vi.fn((..._a: any[]): any => undefined),
  },
}));

vi.mock("../../shared/db.js", () => ({
  db: { transaction: async (cb: (tx: unknown) => Promise<void>) => cb(mockTx) },
}));
vi.mock("../../shared/outbox.js", () => ({
  enqueue: vi.fn(async (..._a: any[]): Promise<any> => undefined),
  markProcessed: vi.fn(async () => true),
}));
vi.mock("./repo.js", () => ({
  insertAccount: (...a: unknown[]) => R.insertAccount(...a),
  insertLedger: (...a: unknown[]) => R.insertLedger(...a),
  lockedBalance: (...a: unknown[]) => R.lockedBalance(...a),
  bumpAccountVersion: (...a: unknown[]) => R.bumpAccountVersion(...a),
  findAccountByEmployee: (...a: unknown[]) => R.findAccountByEmployee(...a),
}));

import { registerF3_gpf_Consumers } from "./f3-consumer.js";
import { COMMANDS } from "../../topics.js";

const TENANT = "10000000-aaaa-4000-8000-000000000001";
const ACTOR = "20000000-bbbb-4000-8000-000000000001";
const EMP = "30000000-cccc-4000-8000-000000000001";
const ACCT = "40000000-dddd-4000-8000-000000000001";

const account = (over: Record<string, unknown> = {}) => ({
  id: ACCT, tenantId: TENANT, employeeId: EMP, gpfNumber: "GPF-1001",
  interestRatePct: "7.10", version: 4, ...over,
});

function makeMsg(payload: Record<string, unknown>) {
  return {
    messageId: randomUUID(),
    type: COMMANDS.f3RouteWrite,
    tenantId: TENANT,
    actorId: ACTOR,
    correlationId: `corr-${randomUUID()}`,
    schemaVersion: "1.0",
    payload,
  };
}

async function run(payload: Record<string, unknown>): Promise<MemoryQueue> {
  const q = new MemoryQueue({ maxAttempts: 1 });
  registerF3_gpf_Consumers(q);
  await q.start();
  await q.publish(COMMANDS.f3RouteWrite, makeMsg({ tenantId: TENANT, query: {}, ...payload }));
  await q.drain();
  return q;
}

beforeEach(() => {
  vi.clearAllMocks();
  R.lockedBalance.mockResolvedValue(0n);
  R.findAccountByEmployee.mockResolvedValue(account());
});

describe("gpf_routes__0 (open GPF account)", () => {
  it("opens the account for the employee in the path, keyed by the queued id", async () => {
    const acctId = randomUUID();
    const q = await run({
      op: "gpf_routes__0", id: acctId, params: { id: EMP },
      body: { gpfNumber: "GPF-2002", openingBalanceMinor: 100000, monthlySubscriptionMinor: 5000, interestRatePct: 7.1 },
    });
    expect(q.dlq).toEqual([]);
    expect(R.insertAccount).toHaveBeenCalledOnce();
    expect(R.insertAccount.mock.calls[0]![1]).toMatchObject({
      id: acctId, tenantId: TENANT, employeeId: EMP, gpfNumber: "GPF-2002",
      openingBalanceMinor: 100000n, monthlySubscriptionMinor: 5000n,
      interestRatePct: "7.1", createdBy: ACTOR,
    });
    // A non-zero opening balance also seeds the ledger.
    expect(R.insertLedger).toHaveBeenCalledOnce();
    expect(R.insertLedger.mock.calls[0]![1]).toMatchObject({
      accountId: acctId, employeeId: EMP, entryType: "opening",
      amountMinor: 100000n, deltaMinor: 100000n, balanceMinor: 100000n,
    });
    await q.stop();
  });

  it("applies the route schema's numeric defaults when the caller omits them", async () => {
    const q = await run({ op: "gpf_routes__0", id: randomUUID(), params: { id: EMP }, body: { gpfNumber: "GPF-3003" } });
    expect(q.dlq).toEqual([]);
    const row = R.insertAccount.mock.calls[0]![1] as Record<string, unknown>;
    // openingBalanceMinor .default(0), monthlySubscriptionMinor .default(0),
    // interestRatePct .default(7.10) — `body` here is the raw pre-Zod payload.
    expect(row.openingBalanceMinor).toBe(0n);
    expect(row.monthlySubscriptionMinor).toBe(0n);
    expect(row.interestRatePct).toBe("7.1");
    // No opening ledger entry when the opening balance is zero.
    expect(R.insertLedger).not.toHaveBeenCalled();
    await q.stop();
  });
});

describe("gpf_routes__2 (interest accrual)", () => {
  it("accrues interest on the locked balance at the account's own rate", async () => {
    R.lockedBalance.mockResolvedValue(100000n);
    const ledgerId = randomUUID();
    const q = await run({ op: "gpf_routes__2", id: ledgerId, params: { id: EMP }, body: { months: 12 } });
    expect(q.dlq).toEqual([]);
    expect(R.findAccountByEmployee).toHaveBeenCalledWith(TENANT, EMP);
    expect(R.insertLedger).toHaveBeenCalledOnce();
    // 100000 paise * 7.10% * 12/12 = 7100 paise
    expect(R.insertLedger.mock.calls[0]![1]).toMatchObject({
      id: ledgerId, tenantId: TENANT, accountId: ACCT, employeeId: EMP,
      entryType: "interest", amountMinor: 7100n, deltaMinor: 7100n, balanceMinor: 107100n,
      narrative: "interest @ 7.1% for 12 month(s)", createdBy: ACTOR,
    });
    // L4: the account's optimistic-lock version is bumped on accrual too.
    expect(R.bumpAccountVersion).toHaveBeenCalledWith(mockTx, TENANT, ACCT, ACTOR, 4);
    await q.stop();
  });

  it("honours ratePctOverride and a partial-year months value", async () => {
    R.lockedBalance.mockResolvedValue(200000n);
    const q = await run({ op: "gpf_routes__2", id: randomUUID(), params: { id: EMP }, body: { months: 6, ratePctOverride: 10 } });
    expect(q.dlq).toEqual([]);
    // 200000 * 10% * 6/12 = 10000
    expect(R.insertLedger.mock.calls[0]![1]).toMatchObject({ amountMinor: 10000n, balanceMinor: 210000n });
    await q.stop();
  });

  it("applies the route schema's months default of 12 when omitted", async () => {
    R.lockedBalance.mockResolvedValue(100000n);
    const q = await run({ op: "gpf_routes__2", id: randomUUID(), params: { id: EMP }, body: {} });
    expect(q.dlq).toEqual([]);
    expect(R.insertLedger.mock.calls[0]![1]).toMatchObject({ amountMinor: 7100n });
    await q.stop();
  });

  it("fails loudly rather than writing when the employee has no GPF account", async () => {
    R.findAccountByEmployee.mockResolvedValue(null);
    const q = await run({ op: "gpf_routes__2", id: randomUUID(), params: { id: EMP }, body: { months: 12 } });
    expect(R.insertLedger).not.toHaveBeenCalled();
    expect(q.dlq).toHaveLength(1);
    expect(q.dlq[0]!.error).toContain("GPF account");
    await q.stop();
  });
});

describe("gpf_routes__1 (subscription / advance / withdrawal / refund)", () => {
  /**
   * routes.ts now forwards `entryType` and `sign` explicitly (previously
   * omitted, so this case could not tell the four routes apart without
   * guessing the credit/debit direction on a statutory PF ledger — see the
   * file-header comment and the prior version of this test file for the
   * "KNOWN UNRESOLVED" state this replaces).
   */
  it.each([
    ["subscription", 1],
    ["refund", 1],
    ["advance", -1],
    ["withdrawal", -1],
  ] as const)("posts a %s using the route-forwarded sign (%d)", async (entryType, sign) => {
    R.lockedBalance.mockResolvedValue(100000n);
    const ledgerId = randomUUID();
    const q = await run({
      op: "gpf_routes__1", id: ledgerId, params: { id: EMP },
      body: { amountMinor: 5000 }, entryType, sign,
    });
    expect(q.dlq).toEqual([]);
    expect(R.findAccountByEmployee).toHaveBeenCalledWith(TENANT, EMP);
    expect(R.insertLedger).toHaveBeenCalledOnce();
    const expectedDelta = sign === 1 ? 5000n : -5000n;
    const expectedBalance = 100000n + expectedDelta;
    expect(R.insertLedger.mock.calls[0]![1]).toMatchObject({
      id: ledgerId, tenantId: TENANT, accountId: ACCT, employeeId: EMP,
      entryType, amountMinor: 5000n, deltaMinor: expectedDelta, balanceMinor: expectedBalance,
      createdBy: ACTOR,
    });
    // L4: the account's optimistic-lock version is bumped on every posting.
    expect(R.bumpAccountVersion).toHaveBeenCalledWith(mockTx, TENANT, ACCT, ACTOR, 4);
    await q.stop();
  });

  it("forwards narrative and effectiveDate onto the ledger row when present", async () => {
    R.lockedBalance.mockResolvedValue(0n);
    const ledgerId = randomUUID();
    const q = await run({
      op: "gpf_routes__1", id: ledgerId, params: { id: EMP },
      body: { amountMinor: 2000, narrative: "monthly sub", effectiveDate: "2026-09-01" },
      entryType: "subscription", sign: 1,
    });
    expect(q.dlq).toEqual([]);
    expect(R.insertLedger.mock.calls[0]![1]).toMatchObject({
      narrative: "monthly sub", effectiveDate: "2026-09-01",
    });
    await q.stop();
  });

  it("omits narrative/effectiveDate from the ledger row when absent (no undefined leaks in)", async () => {
    R.lockedBalance.mockResolvedValue(0n);
    const q = await run({
      op: "gpf_routes__1", id: randomUUID(), params: { id: EMP },
      body: { amountMinor: 2000 }, entryType: "subscription", sign: 1,
    });
    expect(q.dlq).toEqual([]);
    const row = R.insertLedger.mock.calls[0]![1] as Record<string, unknown>;
    expect("narrative" in row).toBe(false);
    expect("effectiveDate" in row).toBe(false);
    await q.stop();
  });

  it("rejects a debit that would drive the balance negative (INSUFFICIENT_BALANCE) without writing", async () => {
    R.lockedBalance.mockResolvedValue(3000n);
    const q = await run({
      op: "gpf_routes__1", id: randomUUID(), params: { id: EMP },
      body: { amountMinor: 5000 }, entryType: "advance", sign: -1,
    });
    expect(R.insertLedger).not.toHaveBeenCalled();
    expect(R.bumpAccountVersion).not.toHaveBeenCalled();
    expect(q.dlq).toHaveLength(1);
    expect(q.dlq[0]!.error).toContain("exceeds available GPF balance");
    await q.stop();
  });

  it("a same-size refund after an advance nets back to the original balance", async () => {
    // advance: 100000 -> 95000
    R.lockedBalance.mockResolvedValue(100000n);
    await run({
      op: "gpf_routes__1", id: randomUUID(), params: { id: EMP },
      body: { amountMinor: 5000 }, entryType: "advance", sign: -1,
    });
    expect(R.insertLedger.mock.calls[0]![1]).toMatchObject({ deltaMinor: -5000n, balanceMinor: 95000n });
    // refund: locked balance now reflects the advance (95000) -> back to 100000
    R.lockedBalance.mockResolvedValue(95000n);
    await run({
      op: "gpf_routes__1", id: randomUUID(), params: { id: EMP },
      body: { amountMinor: 5000 }, entryType: "refund", sign: 1,
    });
    expect(R.insertLedger.mock.calls[1]![1]).toMatchObject({ deltaMinor: 5000n, balanceMinor: 100000n });
  });

  it("fails loudly rather than writing when the employee has no GPF account", async () => {
    R.findAccountByEmployee.mockResolvedValue(null);
    const q = await run({
      op: "gpf_routes__1", id: randomUUID(), params: { id: EMP },
      body: { amountMinor: 5000 }, entryType: "advance", sign: -1,
    });
    expect(R.insertLedger).not.toHaveBeenCalled();
    expect(q.dlq).toHaveLength(1);
    expect(q.dlq[0]!.error).toContain("GPF account");
    await q.stop();
  });
});

describe("F3 gpf consumer — op routing", () => {
  it("ignores ops that belong to another module's consumer", async () => {
    const q = await run({ op: "some_other_module_routes__0", id: randomUUID(), params: {}, body: {} });
    expect(R.insertAccount).not.toHaveBeenCalled();
    expect(R.insertLedger).not.toHaveBeenCalled();
    expect(q.dlq).toEqual([]);
    await q.stop();
  });
});
