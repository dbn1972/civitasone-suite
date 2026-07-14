/**
 * Voting module — cache-first DB reads (CQRS read side, Req 11.1, 11.3, 11.4).
 *
 * This file is READ-ONLY: every write goes through the command publishers in commands.ts
 * (route → zod → queue.publish → 202) and is applied by consumer.ts. Reads follow the suite
 * rule "all reads through Redis cache" — served via `cache.getOrLoad` (keyed
 * `{service}:{tenant}:{resource}:{id}`) with a SHORT 30s TTL because a vote tally is a LIVE
 * figure that changes with every cast (Req 11.3: real-time poll results). The consumer
 * invalidates the same `vote` resource prefix after every ballot / conclude
 * (`invalidateVoteCaches` + `refreshTallyCache`), so the 30s TTL is only the self-healing
 * backstop for a missed invalidation.
 *
 * Cache keys owned here (all under the `vote` resource prefix so the consumer's
 * `cache.invalidateResource(tenantId, "vote")` clears every facet):
 *   - `meeting:{tenant}:vote:{resolutionId}`            → getVoteResults (tally + result)
 *   - `meeting:{tenant}:vote:{meetingId}:active`        → getActiveVotes (open resolutions)
 *   - `meeting:{tenant}:vote:{resolutionId}:positions`  → getVoterPositions (per-member ballots)
 *
 * The authoritative tally is ALWAYS recomputed from the `meeting.votes` rows (the source of
 * truth for P14: `votes_for + votes_against + votes_abstain == count(votes)`) rather than
 * trusting the denormalised counters on the resolution row, so a read never drifts from the
 * recorded ballots.
 *
 * Ownership boundary (steering L2): this module owns `meeting.votes` only. The
 * `meeting.resolutions` table is owned by the decision module and the parent `meeting.meetings`
 * table by meeting-core — both are read here (tenant-scoped) purely as read-side joins /
 * existence guards, never written.
 *
 * _Requirements: 11.1, 11.3, 11.4_
 */
import { and, asc, desc, eq, inArray } from "drizzle-orm";
import { db, scopedRead } from "../../shared/db.js";
import { cache } from "../../shared/infra.js";
import { votes, recusals } from "./schema.js";
import { resolutions } from "../decision/schema.js";
import { meetings } from "../meeting-core/schema.js";
import { committees, committeeMembers } from "../committee/schema.js";
import { requiredQuorumCount, type QuorumRule } from "../committee/domain.js";
import { itemQuorumDenominator } from "./domain.js";
import {
  computeTally,
  computeVoteResult,
  approvalPercentage,
  isMajorityRule,
  type VoteTally,
  type VoteResult,
} from "./domain.js";

/** Cache resource prefix (shared invalidation contract with commands.ts + consumer.ts). */
const RESOURCE = "vote";
/** 30s TTL: a tally is a live figure (Req 11.3) — short bound caps staleness after a cast. */
const TALLY_TTL_SECONDS = 30;

/** Resolution statuses that represent a vote still in progress (open for ballots/responses). */
const ACTIVE_STATUSES = ["voting_open", "circulating"] as const;
/** Secret-ballot votes are aggregated-only — individual positions are never disclosed (Req 11.1). */
const SECRET_BALLOT = "secret_ballot";

// ─── ISO helpers ────────────────────────────────────────────────────────────

/** ISO-8601 string for a timestamptz value, or null passthrough. */
function toIso(value: Date | string | null): string | null {
  if (value === null || value === undefined) return null;
  return value instanceof Date ? value.toISOString() : new Date(value).toISOString();
}

/**
 * Map a circulation position (approve/reject/abstain) onto the tally vocabulary
 * (for/against/abstain) so `computeTally` can score both in-meeting and circulation ballots.
 * In-meeting positions already use for/against/abstain and pass through unchanged.
 */
function toTallyPosition(position: string): string {
  if (position === "approve") return "for";
  if (position === "reject") return "against";
  return position; // for | against | abstain (already in tally vocabulary)
}

/** Recompute the tally from a resolution's recorded ballot positions (P14 source of truth). */
function tallyOf(positions: readonly string[]): VoteTally {
  return computeTally(positions.map(toTallyPosition));
}

// ─── Existence guards (read-side joins, tenant-scoped) ───────────────────────

/** Minimal parent-meeting reference for the route existence guard (uncached — cheap PK lookup). */
export interface MeetingRef {
  id: string;
  committeeId: string | null;
  status: string;
}

/**
 * Direct (uncached) meeting existence lookup, tenant-scoped. Returns null when the meeting is
 * unknown / belongs to another tenant so the routes can answer 404 before publishing a command
 * or serving an active-votes listing. Owned by meeting-core; read here as a boundary guard.
 */
export async function getMeetingRef(tenantId: string, meetingId: string): Promise<MeetingRef | null> {
  const rows = await scopedRead((tx) => tx
    .select({ id: meetings.id, committeeId: meetings.committeeId, status: meetings.status })
    .from(meetings)
    .where(and(eq(meetings.id, meetingId), eq(meetings.tenantId, tenantId)))
    .limit(1));
  return rows[0] ?? null;
}

/** Minimal resolution reference for the cast/conclude route guards. */
export interface ResolutionRef {
  id: string;
  meetingId: string;
  status: string;
  isCirculation: boolean;
}

/**
 * Direct (uncached) resolution existence lookup, tenant-scoped. Returns null when the resolution
 * is unknown / belongs to another tenant so the cast + conclude routes can 404 (and confirm the
 * resolution belongs to the path meeting) before publishing a command.
 */
export async function getResolutionRef(tenantId: string, resolutionId: string): Promise<ResolutionRef | null> {
  const rows = await scopedRead((tx) => tx
    .select({
      id: resolutions.id,
      meetingId: resolutions.meetingId,
      status: resolutions.status,
      isCirculation: resolutions.isCirculation,
    })
    .from(resolutions)
    .where(and(eq(resolutions.id, resolutionId), eq(resolutions.tenantId, tenantId)))
    .limit(1));
  return rows[0] ?? null;
}

// ─── getVoteResults (Req 11.3, 11.4) ─────────────────────────────────────────

/** A resolution's live tally + recorded/projected outcome. */
export interface VoteResultsView {
  resolutionId: string;
  meetingId: string;
  resolutionNumber: string;
  status: string;
  voteType: string;
  majorityRule: string;
  isCirculation: boolean;
  /** Live tally recomputed from the `votes` rows (P14). */
  tally: VoteTally;
  /** Persisted result on the resolution row (pending | passed | rejected | invalid). */
  result: string;
  /** Result the current tally would yield under the configured majority rule (Req 11.4, P16). */
  projectedResult: VoteResult;
  /** Affirmative percentage of ballots cast (display/audit). */
  approvalPercentage: number;
  effectiveDate: string | null;
  /** Achieved response rate (%) for a concluded circulation resolution, else null (Req 12). */
  responseRate: number | null;
  /** True once the resolution has left the open-for-voting state. */
  concluded: boolean;
  dscSignerName: string | null;
  hashCurrent: string | null;
  /** Member ids recused from this motion (Gap 1): excluded from the tally + quorum denominator. */
  recusedMemberIds: string[];
  /** Quorum-for-this-item after recusals — the denominator shrinks by recused roster members. */
  itemQuorum: ItemQuorumView | null;
}

/** Motion-scoped quorum after conflict-of-interest recusals (statutory completeness). */
export interface ItemQuorumView {
  /** Active committee roster size. */
  activeRoster: number;
  /** Recused members who belong to the active roster (excluded from the denominator). */
  recusedCount: number;
  /** Roster minus recused — the effective quorum denominator for THIS motion. */
  effectiveDenominator: number;
  /** Minimum members required for quorum on THIS motion, computed on the shrunk denominator. */
  requiredQuorum: number;
}

/**
 * Vote results for a single resolution (Req 11.3, 11.4). Cache-first on `vote:{resolutionId}`
 * with a 30s TTL (live tally). Returns null — without caching a miss — when the resolution is
 * unknown / belongs to another tenant, so the route answers 404.
 *
 * The tally is recomputed from the recorded ballots (P14 source of truth); `projectedResult`
 * re-derives the majority outcome from that live tally so callers polling an open vote see the
 * outcome it would produce if concluded now.
 */
export async function getVoteResults(tenantId: string, resolutionId: string): Promise<VoteResultsView | null> {
  return cache.getOrLoad<VoteResultsView>(
    cache.makeKey(tenantId, RESOURCE, resolutionId),
    async () => {
      const resRows = await scopedRead((tx) => tx
        .select()
        .from(resolutions)
        .where(and(eq(resolutions.id, resolutionId), eq(resolutions.tenantId, tenantId)))
        .limit(1));
      const resolution = resRows[0];
      if (!resolution) return null;

      const ballotRows = await scopedRead((tx) => tx
        .select({ position: votes.position })
        .from(votes)
        .where(
          and(
            eq(votes.resolutionId, resolutionId),
            eq(votes.tenantId, tenantId),
            eq(votes.isCirculation, resolution.isCirculation),
          ),
        ));
      const tally = tallyOf(ballotRows.map((r) => r.position));

      const rule = isMajorityRule(resolution.majorityRule) ? resolution.majorityRule : "simple_majority";

      // Recusals on this motion (Gap 1): members excluded from the tally + quorum denominator.
      const recusalRows = await scopedRead((tx) => tx
        .select({ memberId: recusals.memberId })
        .from(recusals)
        .where(and(eq(recusals.resolutionId, resolutionId), eq(recusals.tenantId, tenantId))));
      const recusedMemberIds = recusalRows.map((r) => r.memberId);
      const itemQuorum = await computeItemQuorum(tenantId, resolution.meetingId, recusedMemberIds);

      return {
        resolutionId: resolution.id,
        meetingId: resolution.meetingId,
        resolutionNumber: resolution.resolutionNumber,
        status: resolution.status,
        voteType: resolution.voteType,
        majorityRule: rule,
        isCirculation: resolution.isCirculation,
        tally,
        result: resolution.result,
        projectedResult: computeVoteResult(tally, rule),
        approvalPercentage: approvalPercentage(tally),
        effectiveDate: resolution.effectiveDate ? toIso(resolution.effectiveDate) : null,
        responseRate: resolution.responseRate ?? null,
        concluded: !ACTIVE_STATUSES.includes(resolution.status as (typeof ACTIVE_STATUSES)[number]),
        dscSignerName: resolution.dscSignerName ?? null,
        hashCurrent: resolution.hashCurrent ?? null,
        recusedMemberIds,
        itemQuorum,
      };
    },
    TALLY_TTL_SECONDS,
  );
}

/**
 * Compute the motion-scoped quorum after recusals (Gap 1). The active committee roster is the
 * base; recused members who belong to that roster are removed from the denominator, and the
 * required quorum is recomputed on the shrunk denominator via the committee quorum rule. Returns
 * null for a meeting with no committee (no formal quorum rule to apply).
 */
async function computeItemQuorum(
  tenantId: string,
  meetingId: string,
  recusedMemberIds: readonly string[],
): Promise<ItemQuorumView | null> {
  const meetingRows = await scopedRead((tx) => tx
    .select({ committeeId: meetings.committeeId })
    .from(meetings)
    .where(and(eq(meetings.id, meetingId), eq(meetings.tenantId, tenantId)))
    .limit(1));
  const committeeId = meetingRows[0]?.committeeId ?? null;
  if (!committeeId) return null;

  const committeeRows = await scopedRead((tx) => tx
    .select({ quorumRule: committees.quorumRule })
    .from(committees)
    .where(and(eq(committees.id, committeeId), eq(committees.tenantId, tenantId)))
    .limit(1));
  if (!committeeRows[0]) return null;
  const rule = committeeRows[0].quorumRule as QuorumRule;

  const roster = await scopedRead((tx) => tx
    .select({ memberId: committeeMembers.memberId })
    .from(committeeMembers)
    .where(and(
      eq(committeeMembers.tenantId, tenantId),
      eq(committeeMembers.committeeId, committeeId),
      eq(committeeMembers.status, "active"),
    )));
  const rosterIds = new Set(roster.map((r) => r.memberId));
  const activeRoster = rosterIds.size;
  const recusedCount = recusedMemberIds.filter((id) => rosterIds.has(id)).length;
  const effectiveDenominator = itemQuorumDenominator(activeRoster, recusedCount);
  const requiredQuorum = requiredQuorumCount(rule, effectiveDenominator);

  return { activeRoster, recusedCount, effectiveDenominator, requiredQuorum };
}

// ─── getActiveVotes (Req 11.3) ───────────────────────────────────────────────

/** A resolution currently open for voting/response, with its live running tally. */
export interface ActiveVoteView {
  resolutionId: string;
  meetingId: string;
  resolutionNumber: string;
  text: string;
  voteType: string;
  majorityRule: string;
  status: string;
  isCirculation: boolean;
  tally: VoteTally;
  circulationDeadline: string | null;
  createdAt: string;
}

/**
 * List the votes currently open for a meeting (Req 11.3) — resolutions in `voting_open` or
 * `circulating`. Cache-first on `vote:{meetingId}:active` (30s TTL). Tallies for every open
 * resolution are fetched in ONE batched `votes` query (no N+1) and grouped in memory.
 */
export async function getActiveVotes(tenantId: string, meetingId: string): Promise<ActiveVoteView[]> {
  const rows = await cache.getOrLoad<ActiveVoteView[]>(
    cache.makeKey(tenantId, RESOURCE, `${meetingId}:active`),
    async () => {
      const openResolutions = await scopedRead((tx) => tx
        .select()
        .from(resolutions)
        .where(
          and(
            eq(resolutions.tenantId, tenantId),
            eq(resolutions.meetingId, meetingId),
            inArray(resolutions.status, [...ACTIVE_STATUSES]),
          ),
        )
        .orderBy(desc(resolutions.createdAt)));
      if (openResolutions.length === 0) return [];

      // Batch-fetch every ballot for the open resolutions in a single query (no N+1).
      const ids = openResolutions.map((r) => r.id);
      const ballots = await scopedRead((tx) => tx
        .select({ resolutionId: votes.resolutionId, position: votes.position })
        .from(votes)
        .where(and(eq(votes.tenantId, tenantId), inArray(votes.resolutionId, ids))));

      const positionsByResolution = new Map<string, string[]>();
      for (const b of ballots) {
        const list = positionsByResolution.get(b.resolutionId) ?? [];
        list.push(b.position);
        positionsByResolution.set(b.resolutionId, list);
      }

      return openResolutions.map((r) => ({
        resolutionId: r.id,
        meetingId: r.meetingId,
        resolutionNumber: r.resolutionNumber,
        text: r.text,
        voteType: r.voteType,
        majorityRule: isMajorityRule(r.majorityRule) ? r.majorityRule : "simple_majority",
        status: r.status,
        isCirculation: r.isCirculation,
        tally: tallyOf(positionsByResolution.get(r.id) ?? []),
        circulationDeadline: toIso(r.circulationDeadline),
        createdAt: toIso(r.createdAt) ?? new Date(0).toISOString(),
      }));
    },
    TALLY_TTL_SECONDS,
  );
  return rows ?? [];
}

// ─── getVoterPositions (Req 11.1, 11.3) ──────────────────────────────────────

/** One member's recorded position on a resolution (roll_call / electronic_poll transparency). */
export interface VoterPosition {
  memberId: string;
  position: string;
  reason: string | null;
  votedAt: string;
}

/** Per-member positions for a resolution — aggregated-only when the vote is a secret ballot. */
export interface VoterPositionsView {
  resolutionId: string;
  voteType: string;
  /** True when `voteType === "secret_ballot"`: `positions` is withheld, only the tally is shown. */
  secret: boolean;
  tally: VoteTally;
  positions: VoterPosition[];
}

/**
 * Per-member voting positions for a resolution (Req 11.3). Cache-first on
 * `vote:{resolutionId}:positions` (30s TTL). Returns null when the resolution is unknown /
 * cross-tenant so the route answers 404.
 *
 * Secrecy (Req 11.1): a `secret_ballot` is anonymous — its individual positions are NEVER
 * disclosed, so `positions` is returned empty with `secret: true` and only the aggregate tally
 * is exposed. `roll_call` / `electronic_poll` votes are recorded by name and returned in full.
 */
export async function getVoterPositions(tenantId: string, resolutionId: string): Promise<VoterPositionsView | null> {
  return cache.getOrLoad<VoterPositionsView>(
    cache.makeKey(tenantId, RESOURCE, `${resolutionId}:positions`),
    async () => {
      const resRows = await scopedRead((tx) => tx
        .select({ id: resolutions.id, voteType: resolutions.voteType, isCirculation: resolutions.isCirculation })
        .from(resolutions)
        .where(and(eq(resolutions.id, resolutionId), eq(resolutions.tenantId, tenantId)))
        .limit(1));
      const resolution = resRows[0];
      if (!resolution) return null;

      const ballotRows = await scopedRead((tx) => tx
        .select({
          memberId: votes.memberId,
          position: votes.position,
          reason: votes.reason,
          votedAt: votes.votedAt,
        })
        .from(votes)
        .where(
          and(
            eq(votes.resolutionId, resolutionId),
            eq(votes.tenantId, tenantId),
            eq(votes.isCirculation, resolution.isCirculation),
          ),
        )
        .orderBy(asc(votes.votedAt)));

      const tally = tallyOf(ballotRows.map((r) => r.position));
      const secret = resolution.voteType === SECRET_BALLOT;

      return {
        resolutionId: resolution.id,
        voteType: resolution.voteType,
        secret,
        tally,
        positions: secret
          ? []
          : ballotRows.map((r) => ({
              memberId: r.memberId,
              position: r.position,
              reason: r.reason ?? null,
              votedAt: toIso(r.votedAt) ?? new Date(0).toISOString(),
            })),
      };
    },
    TALLY_TTL_SECONDS,
  );
}
