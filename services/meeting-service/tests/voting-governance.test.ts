/**
 * Unit tests — governance completeness domain logic (Gap 1 recusal, Gap 2 weighted voting).
 *
 * Pure/deterministic domain functions, no I/O:
 *   - computeWeightedTally: threshold decided by summed WEIGHT, and a weighted result that
 *     FLIPS versus the headcount result (the core weighted-voting proof).
 *   - assertNotRecused / isMemberRecused: a recused member cannot vote (MEETING_MEMBER_RECUSED).
 *   - itemQuorumDenominator: recused roster members shrink the quorum-for-that-item denominator.
 */
import { describe, it, expect } from "vitest";
import {
  computeTally,
  computeWeightedTally,
  computeVoteResult,
  assertNotRecused,
  isMemberRecused,
  itemQuorumDenominator,
} from "../src/modules/voting/domain.js";

describe("weighted voting (Gap 2)", () => {
  it("sums positions by weight, not headcount", () => {
    const t = computeWeightedTally([
      { position: "for", weight: 3 },
      { position: "against", weight: 1 },
      { position: "for", weight: 1 },
    ]);
    expect(t).toEqual({ votesFor: 4, votesAgainst: 1, votesAbstain: 0, total: 5 });
  });

  it("reduces to headcount when every weight is 1 (weighting disabled)", () => {
    const ballots = [
      { position: "for", weight: 1 },
      { position: "against", weight: 1 },
      { position: "abstain", weight: 1 },
    ];
    expect(computeWeightedTally(ballots)).toEqual(computeTally(ballots.map((b) => b.position)));
  });

  it("weighted result FLIPS the headcount result (2 heads for vs 1 heavy against)", () => {
    const positions = ["for", "for", "against"];
    const headcount = computeTally(positions);
    // Headcount simple-majority: 2 for / 1 against → passed.
    expect(computeVoteResult(headcount, "simple_majority")).toBe("passed");

    // Same three members, but the lone "against" holds weight 5 (e.g. majority shareholder).
    const weighted = computeWeightedTally([
      { position: "for", weight: 1 },
      { position: "for", weight: 1 },
      { position: "against", weight: 5 },
    ]);
    expect(weighted).toEqual({ votesFor: 2, votesAgainst: 5, votesAbstain: 0, total: 7 });
    // Weighted simple-majority: 2 of 7 → rejected. The result flipped.
    expect(computeVoteResult(weighted, "simple_majority")).toBe("rejected");
  });

  it("coerces a non-positive weight to a recorded-but-non-counting 0", () => {
    const t = computeWeightedTally([
      { position: "for", weight: 0 },
      { position: "for", weight: 2 },
    ]);
    expect(t.votesFor).toBe(2);
  });
});

describe("recusal / conflict-of-interest (Gap 1)", () => {
  const recused = ["m-1", "m-2"];

  it("isMemberRecused detects a recused member", () => {
    expect(isMemberRecused(recused, "m-1")).toBe(true);
    expect(isMemberRecused(recused, "m-9")).toBe(false);
  });

  it("assertNotRecused rejects a recused member with MEETING_MEMBER_RECUSED (422)", () => {
    let code: string | undefined;
    let status: number | undefined;
    try {
      assertNotRecused(recused, "m-2");
    } catch (e) {
      code = (e as { code?: string }).code;
      status = (e as { status?: number }).status;
    }
    expect(code).toBe("MEETING_MEMBER_RECUSED");
    expect(status).toBe(422);
  });

  it("assertNotRecused allows a non-recused member", () => {
    expect(() => assertNotRecused(recused, "m-3")).not.toThrow();
  });

  it("itemQuorumDenominator shrinks the denominator by recused roster members", () => {
    expect(itemQuorumDenominator(5, 2)).toBe(3);
    expect(itemQuorumDenominator(3, 5)).toBe(0); // never negative
    expect(itemQuorumDenominator(7, 0)).toBe(7);
  });
});
