/**
 * Voting module — property-based tests (task 13.4).
 *
 * Uses fast-check (fc.property / fc.assert) to validate universal correctness properties
 * for the voting domain pure functions in `src/modules/voting/domain.ts`:
 *
 *   - P14 Vote count consistency — votes_for + votes_against + votes_abstain == count(votes WHERE resolution_id = R)
 *   - P15 Votes ≤ members present — total votes ≤ members present at vote time
 *   - P16 Majority rule correctness — result computed correctly per configured rule
 *         (simple_majority >50%, two_thirds ≥66.67%, three_fourths ≥75%, unanimous 100%)
 *   - P17 No duplicate votes — each member votes at most once per resolution (UNIQUE constraint)
 *
 * **Validates: Requirements 11.2, 11.3, 11.4**
 */
import { describe, it, expect } from "vitest";
import fc from "fast-check";
import { HttpError } from "../src/shared/context.js";
import {
  VOTE_POSITIONS,
  MAJORITY_RULES,
  computeTally,
  isTallyConsistent,
  assertTallyConsistent,
  computeVoteResult,
  hasMemberVoted,
  assertNoDuplicateVote,
  areVotesWithinPresent,
  assertVotesWithinPresent,
  type VoteTally,
  type VotePosition,
  type MajorityRule,
} from "../src/modules/voting/domain.js";

// ---------------------------------------------------------------------------
// Generators
// ---------------------------------------------------------------------------

/** Arbitrary valid vote position: "for" | "against" | "abstain". */
const arbVotePosition = fc.constantFrom<VotePosition>("for", "against", "abstain");

/** Arbitrary array of vote positions (0–50 votes). */
const arbPositions = fc.array(arbVotePosition, { minLength: 0, maxLength: 50 });

/** Arbitrary majority rule. */
const arbMajorityRule = fc.constantFrom<MajorityRule>(
  "simple_majority",
  "two_thirds",
  "three_fourths",
  "unanimous",
);

/** Arbitrary non-negative vote counts for constructing a VoteTally directly. */
const arbVoteCounts = fc.record({
  votesFor: fc.integer({ min: 0, max: 30 }),
  votesAgainst: fc.integer({ min: 0, max: 30 }),
  votesAbstain: fc.integer({ min: 0, max: 30 }),
});

/** Build a valid VoteTally from generated counts (total = sum). */
const arbTally = arbVoteCounts.map(({ votesFor, votesAgainst, votesAbstain }) => ({
  votesFor,
  votesAgainst,
  votesAbstain,
  total: votesFor + votesAgainst + votesAbstain,
}));

/** Arbitrary member ID (UUID-like strings). */
const arbMemberId = fc.uuid();

/** Arbitrary set of unique member IDs (existing voters). */
const arbMemberIds = fc.uniqueArray(fc.uuid(), { minLength: 0, maxLength: 20 });

/** Arbitrary non-negative integer for counts. */
const arbNonNegInt = fc.integer({ min: 0, max: 100 });

// ---------------------------------------------------------------------------
// Independent oracle for P16 (mirrors design thresholds, not the implementation)
// ---------------------------------------------------------------------------

/**
 * Oracle computation for majority rule result. Uses the same cross-multiplication
 * logic documented in the design but is written independently from the SUT.
 */
function oracleVoteResult(tally: VoteTally, rule: MajorityRule): "passed" | "rejected" {
  const { votesFor, total } = tally;
  if (total <= 0) return "rejected";
  switch (rule) {
    case "simple_majority":
      // strictly more than half: votesFor / total > 0.5 ↔ votesFor * 2 > total
      return votesFor * 2 > total ? "passed" : "rejected";
    case "two_thirds":
      // at least two-thirds: votesFor / total >= 2/3 ↔ votesFor * 3 >= total * 2
      return votesFor * 3 >= total * 2 ? "passed" : "rejected";
    case "three_fourths":
      // at least three-fourths: votesFor / total >= 3/4 ↔ votesFor * 4 >= total * 3
      return votesFor * 4 >= total * 3 ? "passed" : "rejected";
    case "unanimous":
      // every ballot in favour
      return votesFor === total ? "passed" : "rejected";
  }
}

// ---------------------------------------------------------------------------
// P14: Vote count consistency
// ---------------------------------------------------------------------------

describe("P14: Vote count consistency", () => {
  it("votes_for + votes_against + votes_abstain == count(votes) for any set of valid positions", () => {
    fc.assert(
      fc.property(arbPositions, (positions) => {
        const tally = computeTally(positions);

        // The three position counts must sum to the total number of ballots
        expect(tally.votesFor + tally.votesAgainst + tally.votesAbstain).toBe(positions.length);
        expect(tally.total).toBe(positions.length);

        // isTallyConsistent agrees when given the correct row count
        expect(isTallyConsistent(tally, positions.length)).toBe(true);
      }),
      { numRuns: 200 },
    );
  });

  it("individual position counts match a filter-based oracle", () => {
    fc.assert(
      fc.property(arbPositions, (positions) => {
        const tally = computeTally(positions);

        expect(tally.votesFor).toBe(positions.filter((p) => p === "for").length);
        expect(tally.votesAgainst).toBe(positions.filter((p) => p === "against").length);
        expect(tally.votesAbstain).toBe(positions.filter((p) => p === "abstain").length);
      }),
      { numRuns: 200 },
    );
  });

  it("isTallyConsistent detects drift between tally and a different row count", () => {
    fc.assert(
      fc.property(arbTally, fc.integer({ min: 0, max: 100 }), (tally, randomCount) => {
        const actualCount = tally.votesFor + tally.votesAgainst + tally.votesAbstain;
        if (randomCount === actualCount) {
          expect(isTallyConsistent(tally, randomCount)).toBe(true);
        } else {
          expect(isTallyConsistent(tally, randomCount)).toBe(false);
        }
      }),
      { numRuns: 200 },
    );
  });

  it("assertTallyConsistent throws when counts diverge from recorded vote count", () => {
    fc.assert(
      fc.property(arbPositions, fc.integer({ min: 1, max: 50 }), (positions, offset) => {
        const tally = computeTally(positions);
        const wrongCount = positions.length + offset; // always different

        expect(() => assertTallyConsistent(tally, wrongCount)).toThrow(HttpError);
        try {
          assertTallyConsistent(tally, wrongCount);
        } catch (err) {
          expect((err as HttpError).code).toBe("VALIDATION_FAILED");
        }
      }),
      { numRuns: 100 },
    );
  });
});

// ---------------------------------------------------------------------------
// P15: Votes ≤ members present
// ---------------------------------------------------------------------------

describe("P15: Votes ≤ members present", () => {
  it("total votes never exceed members present when the invariant holds", () => {
    fc.assert(
      fc.property(arbNonNegInt, arbNonNegInt, (totalVotes, membersPresent) => {
        const within = totalVotes <= membersPresent;
        expect(areVotesWithinPresent(totalVotes, membersPresent)).toBe(within);
      }),
      { numRuns: 200 },
    );
  });

  it("assertVotesWithinPresent passes when votes ≤ present and throws otherwise", () => {
    fc.assert(
      fc.property(arbNonNegInt, arbNonNegInt, (totalVotes, membersPresent) => {
        if (totalVotes <= membersPresent) {
          expect(() => assertVotesWithinPresent(totalVotes, membersPresent)).not.toThrow();
        } else {
          expect(() => assertVotesWithinPresent(totalVotes, membersPresent)).toThrow(HttpError);
          try {
            assertVotesWithinPresent(totalVotes, membersPresent);
          } catch (err) {
            expect((err as HttpError).status).toBe(400);
            expect((err as HttpError).code).toBe("VALIDATION_FAILED");
          }
        }
      }),
      { numRuns: 200 },
    );
  });

  it("vote tally from positions never exceeds the position count (natural invariant)", () => {
    fc.assert(
      fc.property(arbPositions, (positions) => {
        const tally = computeTally(positions);
        // If each member can cast at most one vote, total votes = positions.length
        // and members present >= positions.length ensures the invariant
        expect(areVotesWithinPresent(tally.total, positions.length)).toBe(true);
      }),
      { numRuns: 200 },
    );
  });
});

// ---------------------------------------------------------------------------
// P16: Majority rule correctness
// ---------------------------------------------------------------------------

describe("P16: Majority rule correctness", () => {
  it("result matches independent oracle for all rules across generated tallies", () => {
    fc.assert(
      fc.property(arbTally, arbMajorityRule, (tally, rule) => {
        const result = computeVoteResult(tally, rule);
        const expected = oracleVoteResult(tally, rule);
        expect(result).toBe(expected);
      }),
      { numRuns: 500 },
    );
  });

  it("simple_majority: passes IFF votesFor > 50% of total", () => {
    fc.assert(
      fc.property(arbTally, (tally) => {
        const result = computeVoteResult(tally, "simple_majority");
        if (tally.total <= 0) {
          expect(result).toBe("rejected");
        } else {
          // Strictly more than half
          const shouldPass = tally.votesFor * 2 > tally.total;
          expect(result).toBe(shouldPass ? "passed" : "rejected");
        }
      }),
      { numRuns: 200 },
    );
  });

  it("two_thirds: passes IFF votesFor ≥ 66.67% of total", () => {
    fc.assert(
      fc.property(arbTally, (tally) => {
        const result = computeVoteResult(tally, "two_thirds");
        if (tally.total <= 0) {
          expect(result).toBe("rejected");
        } else {
          const shouldPass = tally.votesFor * 3 >= tally.total * 2;
          expect(result).toBe(shouldPass ? "passed" : "rejected");
        }
      }),
      { numRuns: 200 },
    );
  });

  it("three_fourths: passes IFF votesFor ≥ 75% of total", () => {
    fc.assert(
      fc.property(arbTally, (tally) => {
        const result = computeVoteResult(tally, "three_fourths");
        if (tally.total <= 0) {
          expect(result).toBe("rejected");
        } else {
          const shouldPass = tally.votesFor * 4 >= tally.total * 3;
          expect(result).toBe(shouldPass ? "passed" : "rejected");
        }
      }),
      { numRuns: 200 },
    );
  });

  it("unanimous: passes IFF every ballot is 'for'", () => {
    fc.assert(
      fc.property(arbTally, (tally) => {
        const result = computeVoteResult(tally, "unanimous");
        if (tally.total <= 0) {
          expect(result).toBe("rejected");
        } else {
          expect(result).toBe(tally.votesFor === tally.total ? "passed" : "rejected");
        }
      }),
      { numRuns: 200 },
    );
  });

  it("empty tally (no ballots) is always rejected regardless of rule", () => {
    fc.assert(
      fc.property(arbMajorityRule, (rule) => {
        const empty: VoteTally = { votesFor: 0, votesAgainst: 0, votesAbstain: 0, total: 0 };
        expect(computeVoteResult(empty, rule)).toBe("rejected");
      }),
    );
  });
});

// ---------------------------------------------------------------------------
// P17: No duplicate votes
// ---------------------------------------------------------------------------

describe("P17: No duplicate votes", () => {
  it("hasMemberVoted correctly identifies presence in existing voter set", () => {
    fc.assert(
      fc.property(arbMemberIds, arbMemberId, (existingIds, candidateId) => {
        const asSet = new Set(existingIds);
        const expected = asSet.has(candidateId);

        // Works with Set
        expect(hasMemberVoted(asSet, candidateId)).toBe(expected);
        // Works with array (plain iterable)
        expect(hasMemberVoted(existingIds, candidateId)).toBe(expected);
      }),
      { numRuns: 200 },
    );
  });

  it("assertNoDuplicateVote throws 409 for duplicates and passes for new members", () => {
    fc.assert(
      fc.property(arbMemberIds, arbMemberId, (existingIds, candidateId) => {
        const isDuplicate = existingIds.includes(candidateId);

        if (isDuplicate) {
          expect(() => assertNoDuplicateVote(existingIds, candidateId)).toThrow(HttpError);
          try {
            assertNoDuplicateVote(existingIds, candidateId);
          } catch (err) {
            expect((err as HttpError).status).toBe(409);
            expect((err as HttpError).code).toBe("MEETING_DUPLICATE_VOTE");
          }
        } else {
          expect(() => assertNoDuplicateVote(existingIds, candidateId)).not.toThrow();
        }
      }),
      { numRuns: 200 },
    );
  });

  it("a member who already voted can never vote again (set-based idempotency)", () => {
    fc.assert(
      fc.property(
        fc.uniqueArray(fc.uuid(), { minLength: 1, maxLength: 15 }),
        (members) => {
          // Pick a random member from the existing list
          const voterIndex = Math.floor(Math.random() * members.length);
          const existingVoter = members[voterIndex]!;

          // They should always be detected as a duplicate
          expect(hasMemberVoted(new Set(members), existingVoter)).toBe(true);
          expect(() => assertNoDuplicateVote(members, existingVoter)).toThrow(HttpError);
        },
      ),
      { numRuns: 200 },
    );
  });

  it("a fresh member ID never collides with existing voters", () => {
    fc.assert(
      fc.property(
        arbMemberIds,
        fc.uuid(),
        (existingIds, freshId) => {
          // Pre-condition: freshId is not in existing (skip if it collides by chance)
          fc.pre(!existingIds.includes(freshId));

          expect(hasMemberVoted(existingIds, freshId)).toBe(false);
          expect(hasMemberVoted(new Set(existingIds), freshId)).toBe(false);
          expect(() => assertNoDuplicateVote(existingIds, freshId)).not.toThrow();
        },
      ),
      { numRuns: 200 },
    );
  });
});
