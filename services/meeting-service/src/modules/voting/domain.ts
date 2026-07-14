/**
 * Voting module — pure domain logic (no I/O, no side effects, fully unit/property testable).
 *
 * Responsibilities (Req 11.1–11.6):
 *   - Vocabularies: vote types, positions, majority rules, results.
 *   - Vote tally computation and consistency (P14).
 *   - Majority-rule result computation: simple_majority / two_thirds / three_fourths /
 *     unanimous (Req 11.3, 11.4, P16).
 *   - Quorum-at-vote-time verification (Req 11.2).
 *   - Duplicate-vote prevention (Req 11.3, P17) — the domain pre-check that complements the
 *     DB `UNIQUE(resolution_id, member_id)` constraint.
 *   - Votes-≤-members-present guard (P15).
 *
 * Domain-rule violations are raised as the service's typed `HttpError` (via `httpError`) so
 * the standard error envelope + HTTP status contract is preserved end-to-end. These functions
 * remain pure and deterministic given their inputs — they perform no I/O.
 *
 * This file is the source of truth for the voting correctness properties exercised in task
 * 13.4: P14 (`computeTally`/`isTallyConsistent`), P15 (`assertVotesWithinPresent`),
 * P16 (`computeVoteResult`), P17 (`assertNoDuplicateVote`).
 *
 * _Requirements: 11.1, 11.2, 11.3, 11.4, 11.5, 11.6_
 */
import { httpError } from "../../shared/context.js";

// ─── Domain vocabularies (mirror the migration CHECK-able value sets) ────────

/**
 * Supported voting mechanisms (Req 11.1). `roll_call` and `electronic_poll` record each
 * member's position individually (Req 11.3); `show_of_hands` and `secret_ballot` record
 * aggregate tallies; `circulation_resolution` is the asynchronous out-of-meeting vote (Req 12).
 */
export const VOTE_TYPES = [
  "show_of_hands",
  "roll_call",
  "secret_ballot",
  "electronic_poll",
  "circulation_resolution",
] as const;
export type VoteType = (typeof VOTE_TYPES)[number];

/** A single member's recorded position on a resolution (Req 11.3). */
export const VOTE_POSITIONS = ["for", "against", "abstain"] as const;
export type VotePosition = (typeof VOTE_POSITIONS)[number];

/** Configured majority rule applied when concluding a vote (Req 11.3, 11.4). */
export const MAJORITY_RULES = ["simple_majority", "two_thirds", "three_fourths", "unanimous"] as const;
export type MajorityRule = (typeof MAJORITY_RULES)[number];

/** Terminal outcome of a concluded in-meeting vote (Req 11.4). */
export const VOTE_RESULTS = ["passed", "rejected"] as const;
export type VoteResult = (typeof VOTE_RESULTS)[number];

/** True if `value` is a recognised vote position. */
export function isVotePosition(value: string): value is VotePosition {
  return (VOTE_POSITIONS as readonly string[]).includes(value);
}

/** True if `value` is a recognised majority rule. */
export function isMajorityRule(value: string): value is MajorityRule {
  return (MAJORITY_RULES as readonly string[]).includes(value);
}

// ─── Vote tally (Req 11.4 · P14) ───────────────────────────────────────────────

/** Aggregated position counts for a resolution's votes. */
export interface VoteTally {
  /** Number of `for` positions. */
  votesFor: number;
  /** Number of `against` positions. */
  votesAgainst: number;
  /** Number of `abstain` positions. */
  votesAbstain: number;
  /** Total ballots cast = votesFor + votesAgainst + votesAbstain. */
  total: number;
}

/**
 * Tally a set of recorded positions into `{ votesFor, votesAgainst, votesAbstain, total }`.
 *
 * Because every position is exactly one of for | against | abstain, `total` (the sum of the
 * three counts) always equals the number of votes tallied — this is the invariant P14
 * (`votes_for + votes_against + votes_abstain == count(votes)`). Any unrecognised position is
 * rejected as `VALIDATION_FAILED` (400) so a malformed row can never silently break the sum.
 */
export function computeTally(positions: readonly string[]): VoteTally {
  let votesFor = 0;
  let votesAgainst = 0;
  let votesAbstain = 0;
  for (const p of positions) {
    switch (p) {
      case "for":
        votesFor += 1;
        break;
      case "against":
        votesAgainst += 1;
        break;
      case "abstain":
        votesAbstain += 1;
        break;
      default:
        throw httpError("VALIDATION_FAILED", `unknown vote position: ${String(p)}`, { position: p });
    }
  }
  return { votesFor, votesAgainst, votesAbstain, total: votesFor + votesAgainst + votesAbstain };
}

/**
 * Vote-count consistency check (P14): the tally's three position counts must sum to the
 * number of vote rows recorded for the resolution. Given `computeTally` derives `total` from
 * the same three counts, this holds by construction; the explicit check guards against a tally
 * assembled from a different source (e.g. denormalised counters on the resolution row) drifting
 * out of sync with the underlying `votes` rows.
 */
export function isTallyConsistent(tally: VoteTally, recordedVoteCount: number): boolean {
  return tally.votesFor + tally.votesAgainst + tally.votesAbstain === recordedVoteCount;
}

/**
 * Assert the tally is consistent with the recorded vote-row count (P14), else throw
 * `VALIDATION_FAILED` (400) with the observed values for diagnosis.
 */
export function assertTallyConsistent(tally: VoteTally, recordedVoteCount: number): void {
  if (!isTallyConsistent(tally, recordedVoteCount)) {
    throw httpError("VALIDATION_FAILED", "vote tally does not match recorded vote count", {
      votesFor: tally.votesFor,
      votesAgainst: tally.votesAgainst,
      votesAbstain: tally.votesAbstain,
      sum: tally.votesFor + tally.votesAgainst + tally.votesAbstain,
      recordedVoteCount,
    });
  }
}

// ─── Majority-rule result (Req 11.3, 11.4 · P16) ────────────────────────────────

/**
 * Compute the result of a concluded vote per the configured majority rule (P16).
 *
 * Denominator convention: the threshold is measured against the TOTAL ballots cast
 * (`for + against + abstain`). Abstentions therefore count toward the base — a conservative
 * governance stance under which abstaining makes a super-majority harder to reach, and which
 * gives "unanimous = 100%" its literal meaning (every ballot is `for`). This matches the
 * design's stated thresholds (simple > 50%, two_thirds ≥ 66.67%, three_fourths ≥ 75%,
 * unanimous 100%) and the P14 total (`for + against + abstain`).
 *
 * Comparisons use exact integer cross-multiplication (no floating point), so the fractional
 * thresholds are evaluated precisely:
 *   - simple_majority: votesFor * 2 >  total          (strictly more than half)
 *   - two_thirds:      votesFor * 3 >= total * 2       (at least two-thirds)
 *   - three_fourths:   votesFor * 4 >= total * 3       (at least three-fourths)
 *   - unanimous:       votesFor === total              (every ballot in favour)
 *
 * A vote with no ballots cast (`total <= 0`) can never pass and returns `rejected`.
 */
export function computeVoteResult(tally: VoteTally, rule: MajorityRule): VoteResult {
  const { votesFor, total } = tally;
  if (total <= 0) return "rejected";
  switch (rule) {
    case "simple_majority":
      return votesFor * 2 > total ? "passed" : "rejected";
    case "two_thirds":
      return votesFor * 3 >= total * 2 ? "passed" : "rejected";
    case "three_fourths":
      return votesFor * 4 >= total * 3 ? "passed" : "rejected";
    case "unanimous":
      return votesFor === total ? "passed" : "rejected";
    default: {
      // Exhaustiveness guard: an unknown rule is a programming/config error, not client input.
      const _exhaustive: never = rule;
      throw httpError("VALIDATION_FAILED", `unknown majority rule: ${String(_exhaustive)}`);
    }
  }
}

/** Affirmative-vote percentage of total ballots cast (0 when no ballots). For display/audit. */
export function approvalPercentage(tally: VoteTally): number {
  return tally.total > 0 ? (tally.votesFor / tally.total) * 100 : 0;
}

// ─── Weighted voting (config-gated: voting.weighted_enabled) ─────────────────────

/** A single ballot carrying the member's vote weight (default 1 = headcount). */
export interface WeightedBallot {
  position: string;
  /** The member/seat vote weight applied to this ballot (board shareholding / ex-officio). */
  weight: number;
}

/**
 * Weighted tally: sum each position by the ballot's WEIGHT rather than by headcount, so a
 * board's shareholding or ex-officio weighting decides the outcome (config toggle
 * `voting.weighted_enabled`). The returned shape is the same `VoteTally` — `votesFor` etc.
 * hold the summed WEIGHTS and `total` is the summed weight of all ballots — so
 * `computeVoteResult` scores it by exact integer cross-multiplication with NO change: a
 * threshold is measured against summed weight, not summed heads. A non-positive or non-finite
 * weight is coerced to 0 (a zero-weight seat casts a recorded-but-non-counting ballot). Any
 * unrecognised position is rejected as `VALIDATION_FAILED` (400), mirroring `computeTally`.
 *
 * When weighting is DISABLED every weight is 1, so `computeWeightedTally` reduces exactly to
 * `computeTally` (1 member = 1 vote) — behavior is unchanged.
 */
export function computeWeightedTally(ballots: readonly WeightedBallot[]): VoteTally {
  let votesFor = 0;
  let votesAgainst = 0;
  let votesAbstain = 0;
  for (const b of ballots) {
    const w = Number.isFinite(b.weight) && b.weight > 0 ? Math.trunc(b.weight) : 0;
    switch (b.position) {
      case "for":
        votesFor += w;
        break;
      case "against":
        votesAgainst += w;
        break;
      case "abstain":
        votesAbstain += w;
        break;
      default:
        throw httpError("VALIDATION_FAILED", `unknown vote position: ${String(b.position)}`, { position: b.position });
    }
  }
  return { votesFor, votesAgainst, votesAbstain, total: votesFor + votesAgainst + votesAbstain };
}

// ─── Recusal / conflict-of-interest (statutory completeness) ─────────────────────

/** True if `memberId` is among the members recused on the motion. */
export function isMemberRecused(recusedMemberIds: Iterable<string>, memberId: string): boolean {
  if (recusedMemberIds instanceof Set) return recusedMemberIds.has(memberId);
  for (const id of recusedMemberIds) {
    if (id === memberId) return true;
  }
  return false;
}

/**
 * Enforce that a recused member cannot cast a vote on the motion they are recused from
 * (statutory conflict-of-interest rule). Throws `MEETING_MEMBER_RECUSED` (422). A recused
 * member never enters the tally (they cannot cast) and is excluded from the quorum-for-that-
 * item denominator (see `itemQuorumDenominator`).
 */
export function assertNotRecused(recusedMemberIds: Iterable<string>, memberId: string): void {
  if (isMemberRecused(recusedMemberIds, memberId)) {
    throw httpError("MEETING_MEMBER_RECUSED", "member is recused from this motion and cannot vote", { memberId });
  }
}

/**
 * The quorum denominator for a specific motion after recusals: the active roster size minus the
 * count of recused members who belong to that roster. Recused members are excluded from BOTH the
 * present-count numerator and this denominator so a motion's quorum is assessed on the members
 * actually eligible to decide it. Never returns below 0.
 */
export function itemQuorumDenominator(activeRosterSize: number, recusedRosterCount: number): number {
  return Math.max(0, activeRosterSize - Math.max(0, recusedRosterCount));
}

// ─── Quorum-at-vote-time (Req 11.2) ─────────────────────────────────────────────

/** Inputs for verifying quorum still holds at the moment a vote is initiated. */
export interface VoteQuorumCheck {
  /** Count of quorum-eligible members present at vote time. */
  membersPresent: number;
  /** Minimum members required for quorum (from the committee's quorum rule). */
  requiredQuorum: number;
}

/** True IFF quorum is still met at vote time (`membersPresent >= requiredQuorum`). */
export function isQuorumMetAtVoteTime(check: VoteQuorumCheck): boolean {
  return check.membersPresent >= check.requiredQuorum;
}

/**
 * Enforce that quorum is still met when the chairperson initiates a vote (Req 11.2). Throws
 * `MEETING_QUORUM_NOT_MET` (422) — the vote initiation must be rejected if quorum was lost.
 */
export function assertQuorumAtVoteTime(check: VoteQuorumCheck): void {
  if (!isQuorumMetAtVoteTime(check)) {
    throw httpError("MEETING_QUORUM_NOT_MET", "quorum is not met at vote time; cannot initiate vote", {
      membersPresent: check.membersPresent,
      requiredQuorum: check.requiredQuorum,
    });
  }
}

// ─── Duplicate-vote prevention (Req 11.3 · P17) ─────────────────────────────────

/** True if `memberId` already appears among the members who have voted on the resolution. */
export function hasMemberVoted(existingVoterIds: Iterable<string>, memberId: string): boolean {
  if (existingVoterIds instanceof Set) return existingVoterIds.has(memberId);
  for (const id of existingVoterIds) {
    if (id === memberId) return true;
  }
  return false;
}

/**
 * Pre-check the one-vote-per-member rule before recording a cast (Req 11.3, P17). Throws
 * `MEETING_DUPLICATE_VOTE` (409) when the member has already voted on this resolution. This
 * complements the DB `UNIQUE(resolution_id, member_id)` constraint, turning the race-loser's
 * constraint violation into a clean, typed conflict for the client.
 */
export function assertNoDuplicateVote(existingVoterIds: Iterable<string>, memberId: string): void {
  if (hasMemberVoted(existingVoterIds, memberId)) {
    throw httpError("MEETING_DUPLICATE_VOTE", "member has already voted on this resolution", { memberId });
  }
}

// ─── Votes ≤ members present (P15) ──────────────────────────────────────────────

/** True IFF the number of ballots cast does not exceed the members present at vote time. */
export function areVotesWithinPresent(totalVotes: number, membersPresent: number): boolean {
  return totalVotes <= membersPresent;
}

/**
 * Enforce that the ballots cast never exceed the members present at vote time (P15). A breach
 * indicates a phantom/duplicate ballot and is rejected as `VALIDATION_FAILED` (400).
 */
export function assertVotesWithinPresent(totalVotes: number, membersPresent: number): void {
  if (!areVotesWithinPresent(totalVotes, membersPresent)) {
    throw httpError("VALIDATION_FAILED", "recorded votes exceed members present at vote time", {
      totalVotes,
      membersPresent,
    });
  }
}
