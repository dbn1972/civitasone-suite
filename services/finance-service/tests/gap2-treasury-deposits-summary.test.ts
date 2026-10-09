/**
 * GAP2-FINANCE-TREASURY-DEPOSITS-TOTALS-06: the deposits register totals come
 * from a server-side aggregate over ALL deposits, so the counts and the active
 * balance are never derived from the (default-50) page. DB-free: the repo
 * aggregate is mocked.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("../src/shared/infra.js", () => ({
  cache: { getOrLoad: vi.fn(async () => null), makeKey: (...p: string[]) => p.join(":") },
}));

const getDepositStatusAggregates = vi.fn();
vi.mock("../src/modules/treasury/repo.js", () => ({
  getDepositStatusAggregates: (...a: unknown[]) => getDepositStatusAggregates(...a),
  findBankById: vi.fn(),
}));

import { getDepositsSummary } from "../src/modules/treasury/queries.js";

const TENANT = "aaaaaaaa-3333-4000-8000-0000000000b1";

beforeEach(() => getDepositStatusAggregates.mockReset());

describe("getDepositsSummary", () => {
  it("counts every status and sums balance over ACTIVE deposits only", async () => {
    getDepositStatusAggregates.mockResolvedValue([
      { status: "active", n: 55, balanceMinor: 123456789012345n },
      { status: "refunded", n: 3, balanceMinor: 0n },
      { status: "forfeited", n: 2, balanceMinor: 0n },
    ]);
    const s = await getDepositsSummary(TENANT);
    expect(s.total).toBe(60);
    expect(s.active).toBe(55);
    expect(s.refunded).toBe(3);
    expect(s.forfeited).toBe(2);
    expect(s.activeBalanceMinor).toBe("123456789012345"); // bigint-safe, not capped
  });
});
