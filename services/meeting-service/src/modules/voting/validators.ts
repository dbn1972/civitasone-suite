/**
 * Voting module — Zod request validators (route boundary).
 *
 * Every write route parses its body through one of these before publishing a command
 * (route → zod → queue.publish → 202). Shapes mirror the `COMMANDS.vote*` payload contracts
 * (voteInitiate, voteCast, voteConclude) in src/topics.ts. `meetingId` (and, where the route
 * carries it, `resolutionId`) come from the path params and are merged in by the route, so the
 * body schemas below cover the request body only.
 *
 * The vote position, vote type, and majority rule enums are sourced from `domain.ts` so the
 * wire contract and the domain vocabularies can never drift apart.
 *
 * _Requirements: 11.1, 11.2, 11.3, 11.4, 11.5, 11.6_
 */
import { z } from "zod";
import { VOTE_TYPES, VOTE_POSITIONS, MAJORITY_RULES } from "./domain.js";

const uuid = z.string().uuid();
/** ISO calendar date `YYYY-MM-DD` (matches Drizzle `date` columns). */
const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "expected date in YYYY-MM-DD format");

const voteType = z.enum(VOTE_TYPES);
const votePosition = z.enum(VOTE_POSITIONS);
const majorityRule = z.enum(MAJORITY_RULES);

// ─── Initiate vote (Req 11.1, 11.2, 11.4) ───────────────────────────────────────

/**
 * Initiate a vote on a resolution (Req 11.2). The consumer verifies quorum is still met
 * (`assertQuorumAtVoteTime`) before opening the resolution for voting and rejects initiation
 * if quorum has been lost. `resolutionText` and `voteType` are required; `majorityRule`
 * defaults to simple majority. Optional `agendaItemId` / `decisionId` link the vote to the
 * item under discussion and any pre-recorded decision. `effectiveDate` may be pre-set here or
 * supplied at conclusion (Req 11.4).
 */
export const voteInitiateSchema = z.object({
  resolutionText: z.string().trim().min(1).max(20_000),
  voteType,
  majorityRule: majorityRule.default("simple_majority"),
  agendaItemId: uuid.optional(),
  decisionId: uuid.optional(),
  effectiveDate: isoDate.optional(),
});
export type VoteInitiateInput = z.infer<typeof voteInitiateSchema>;

// ─── Cast vote (Req 11.3, 11.6) ─────────────────────────────────────────────────

/**
 * Cast a single member's vote on an open resolution (Req 11.3). `position` is for | against |
 * abstain; the voting member is the authenticated actor (resolved from context in the
 * consumer), so it is not part of the body. `reason` optionally captures a dissent note or
 * comment (Req 11.6) attached to the vote record. The consumer pre-checks the one-vote-per-
 * member rule (`assertNoDuplicateVote`, backed by the DB UNIQUE constraint, P17).
 */
export const voteCastSchema = z.object({
  resolutionId: uuid,
  position: votePosition,
  reason: z.string().trim().max(2_000).optional(),
});
export type VoteCastInput = z.infer<typeof voteCastSchema>;

// ─── Conclude vote (Req 11.4) ───────────────────────────────────────────────────

/**
 * Conclude an open vote (Req 11.4). The consumer tallies the recorded positions, computes the
 * result per the resolution's configured majority rule (`computeVoteResult`), assigns the
 * sequential resolution number, and records the outcome. `resolutionId` is taken from the path;
 * `effectiveDate` optionally sets the resolution's effective date when it differs from the
 * conclusion date.
 */
export const voteConcludeSchema = z.object({
  effectiveDate: isoDate.optional(),
});
export type VoteConcludeInput = z.infer<typeof voteConcludeSchema>;

// ─── Path params ─────────────────────────────────────────────────────────────

/** `:meetingId` path param (initiate, cast, results, conclude, active). */
export const meetingIdParam = z.object({ meetingId: uuid });

/** `:meetingId/:resolutionId` path params (get results, conclude). */
export const resolutionPathParams = z.object({
  meetingId: uuid,
  resolutionId: uuid,
});
