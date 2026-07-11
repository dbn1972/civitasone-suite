/**
 * Voting module — SQS / RabbitMQ consumer handlers (CQRS write side, Req 11.1–11.5, 12.3, 12.6).
 *
 * Every handler follows the mandatory order (steering: Concurrency & Data Integrity):
 *   1. ONE `db.transaction()` per message.
 *   2. `markProcessed(tx, msg.messageId)` FIRST — if it returns false the message was already
 *      processed, so we skip (idempotency; P30).
 *   3. Business write (INSERT vote / open or conclude a resolution; optimistic-locked
 *      `versionedUpdate` where a version bump matters).
 *   4. Emit domain EVENTS + an audit fact + member notifications via the transactional outbox
 *      (same tx, so "DB committed ⇒ event delivered" with no dual-write hole).
 *   5. AFTER commit, refresh / invalidate the read-through caches.
 *
 * Ownership boundary (steering L2): this module owns `meeting.votes` only. The
 * `meeting.resolutions` table is owned by the decision module — it is imported from
 * `../decision/schema.js` and never redefined here. A vote OPENS a resolution
 * (`status = voting_open`), records ballots against it, and CONCLUDES it (computing the result
 * and assigning the sequential resolution number). Circulation resolutions (Req 12) are opened
 * by the decision module's circulation-init flow; this consumer only records member responses
 * and computes the final outcome once everyone responds or the deadline passes.
 *
 * Pure logic lives in domain.ts (`computeTally`, `computeVoteResult`, `assertQuorumAtVoteTime`,
 * `assertNoDuplicateVote`) and in the decision/committee domains (resolution numbering, quorum
 * counting, circulation-result computation); this file wires those to persistence.
 *
 * Registration: `registerVotingConsumers(register)` maps each voting COMMANDS topic to its
 * handler. worker.ts (task 19.1) passes its `registerConsumer` here.
 *
 * _Requirements: 11.1, 11.2, 11.3, 11.4, 11.5, 12.3, 12.6_
 */
import { createHash, randomUUID } from "node:crypto";
import { and, eq, inArray, sql } from "drizzle-orm";
import type { PgUpdateSetSource } from "drizzle-orm/pg-core";
import type { CommandEnvelope } from "@civitasone/queue";
import { NonRetryableError } from "@civitasone/queue";
import { NOTIFICATION_SEND, buildNotificationPayload } from "@civitasone/events";
import { db, scopedRead } from "../../shared/db.js";
import { cache } from "../../shared/infra.js";
import { enqueue, markProcessed, versionedUpdate, type DrizzleTx } from "../../shared/outbox.js";
import { httpError } from "../../shared/context.js";
import { COMMANDS, EVENTS, SERVICE } from "../../topics.js";
import { votes, recusals } from "./schema.js";
import { resolutions } from "../decision/schema.js";
import { committees, committeeMembers } from "../committee/schema.js";
import { meetings } from "../meeting-core/schema.js";
import { attendanceRecords } from "../attendance/schema.js";
import {
  computeTally,
  computeWeightedTally,
  computeVoteResult,
  assertQuorumAtVoteTime,
  assertNoDuplicateVote,
  assertNotRecused,
  isMajorityRule,
} from "./domain.js";
import { getPolicyBool, getPolicyString } from "../config-registry/policy.js";
import { countQuorumEligible, requiredQuorumCount, type QuorumRule } from "../committee/domain.js";
import {
  computeCirculationResult,
  generateResolutionNumber,
  nextResolutionSequence,
  resolutionFinancialYear,
} from "../decision/domain.js";

const AUDIT_TOPIC = "audit.event.record";
const CACHE_RESOURCE = "vote";
const TALLY_RESOURCE = "vote-tally";
/** 30s TTL for the live vote-tally cache (Req 11.3: real-time poll results). */
const TALLY_TTL_SECONDS = 30;

// Resolution lifecycle status values used by the voting flow. `status` is a free-form
// VARCHAR(16) in the migration (no CHECK), so these interim/terminal values coexist with the
// decision module's register statuses (effective / superseded / withdrawn).
const STATUS_VOTING_OPEN = "voting_open";
const STATUS_CIRCULATING = "circulating";
const STATUS_EFFECTIVE = "effective";
const STATUS_REJECTED = "rejected";
const STATUS_INVALID = "invalid";
/** Interim `result` while a resolution is open for voting (finalised on conclude). */
const RESULT_PENDING = "pending";
/** Resolution statuses that are terminal — a further vote/conclude is a no-op. */
const TERMINAL_STATUSES = new Set([STATUS_EFFECTIVE, STATUS_REJECTED, STATUS_INVALID]);

// ─── Command payload contracts (mirror topics.ts COMMANDS.vote*) ───────────────

interface VoteInitiatePayload {
  resolutionId: string;
  meetingId: string;
  tenantId: string;
  resolutionText: string;
  voteType: string;
  /** Optional — falls back to the tenant's configured `voting.default_threshold`. */
  majorityRule?: string;
  agendaItemId?: string;
  decisionId?: string;
  effectiveDate?: string;
}

interface VoteCastPayload {
  meetingId: string;
  resolutionId: string;
  memberId: string;
  position: "for" | "against" | "abstain";
  tenantId: string;
  reason?: string;
}

interface VoteConcludePayload {
  meetingId: string;
  resolutionId: string;
  tenantId: string;
  effectiveDate?: string;
}

interface VoteRecusePayload {
  meetingId: string;
  resolutionId: string;
  memberId: string;
  reason: string;
  tenantId: string;
  registerRef?: string;
  agendaItemId?: string;
}

interface CirculationRespondPayload {
  resolutionId: string;
  memberId: string;
  position: "approve" | "reject" | "abstain";
  tenantId: string;
  comment?: string;
}

// ─── Shared helpers ────────────────────────────────────────────────────────────

type MsgMeta = { tenantId: string; actorId: string; correlationId: string };

/** Today (or `when`) as an ISO `YYYY-MM-DD` string (matches the `date` columns). */
function isoDate(when: Date): string {
  return when.toISOString().slice(0, 10);
}

/** Emit a standard audit fact for every mutation (steering: audit on every mutation). */
async function audit(
  tx: DrizzleTx,
  msg: MsgMeta,
  action: string,
  resourceId: string,
  metadata?: Record<string, unknown>,
): Promise<void> {
  await enqueue(tx, {
    topic: AUDIT_TOPIC,
    eventType: AUDIT_TOPIC,
    tenantId: msg.tenantId,
    actorId: msg.actorId,
    correlationId: msg.correlationId,
    payload: {
      service: SERVICE,
      action,
      resourceType: "resolution",
      resourceId,
      outcome: "success",
      ...(metadata ? { metadata } : {}),
    },
  });
}

/**
 * Fan out a member notification via the canonical `notification.send` contract
 * (@civitasone/events). Recipients are addressed by their member id (`recipientId`);
 * notification-service resolves the concrete channel address and applies the template.
 * Emitted through the outbox so notifications commit atomically with the write (Req 12.1).
 */
async function notifyMembers(
  tx: DrizzleTx,
  msg: MsgMeta,
  memberIds: readonly string[],
  eventType: string,
  variables: Record<string, string>,
): Promise<void> {
  for (const memberId of memberIds) {
    await enqueue(tx, {
      topic: NOTIFICATION_SEND,
      eventType: NOTIFICATION_SEND,
      tenantId: msg.tenantId,
      actorId: msg.actorId,
      correlationId: msg.correlationId,
      payload: buildNotificationPayload({
        eventType,
        recipient: memberId,
        recipientId: memberId,
        channel: "in_app",
        variables,
      }),
    });
  }
}

/** Load the parent meeting (committee + quorum flag) within the tx. */
async function getMeeting(
  tx: DrizzleTx,
  meetingId: string,
  tenantId: string,
): Promise<{ id: string; committeeId: string | null; quorumEstablished: boolean } | null> {
  const rows = await tx
    .select({
      id: meetings.id,
      committeeId: meetings.committeeId,
      quorumEstablished: meetings.quorumEstablished,
    })
    .from(meetings)
    .where(and(eq(meetings.id, meetingId), eq(meetings.tenantId, tenantId)))
    .limit(1);
  return rows[0] ?? null;
}

/** Load a single resolution row (full) within the tx. */
async function getResolution(tx: DrizzleTx, resolutionId: string, tenantId: string) {
  const rows = await tx
    .select()
    .from(resolutions)
    .where(and(eq(resolutions.id, resolutionId), eq(resolutions.tenantId, tenantId)))
    .limit(1);
  return rows[0] ?? null;
}

/**
 * The member's per-seat vote weight from the committee roster (weighted voting). Defaults to 1
 * when the member is not on the roster or the meeting has no committee — so an unconfigured
 * weight is exactly headcount (1 member = 1 vote).
 */
async function getMemberVoteWeight(
  tx: DrizzleTx,
  tenantId: string,
  committeeId: string | null,
  memberId: string,
): Promise<number> {
  if (!committeeId) return 1;
  const rows = await tx
    .select({ voteWeight: committeeMembers.voteWeight })
    .from(committeeMembers)
    .where(
      and(
        eq(committeeMembers.tenantId, tenantId),
        eq(committeeMembers.committeeId, committeeId),
        eq(committeeMembers.memberId, memberId),
        eq(committeeMembers.status, "active"),
      ),
    )
    .limit(1);
  const w = rows[0]?.voteWeight;
  return typeof w === "number" && Number.isFinite(w) && w > 0 ? w : 1;
}

/** Active committee member ids (Req 12.1 notification fan-out; roster size for quorum). */
async function getActiveMemberIds(tx: DrizzleTx, committeeId: string, tenantId: string): Promise<string[]> {
  const rows = await tx
    .select({ memberId: committeeMembers.memberId })
    .from(committeeMembers)
    .where(
      and(
        eq(committeeMembers.tenantId, tenantId),
        eq(committeeMembers.committeeId, committeeId),
        eq(committeeMembers.status, "active"),
      ),
    );
  return rows.map((r) => r.memberId);
}

/**
 * Re-verify quorum at vote time (Req 11.2): count quorum-eligible attendees present and the
 * committee's required quorum. Returns null when the meeting has no committee (no formal quorum
 * rule to apply). Uses the committee-domain helpers so the count/percentage/VC-exclusion logic
 * matches quorum establishment exactly.
 */
async function computeVoteTimeQuorum(
  tx: DrizzleTx,
  meetingId: string,
  tenantId: string,
  committeeId: string | null,
): Promise<{ membersPresent: number; requiredQuorum: number } | null> {
  if (!committeeId) return null;
  const committeeRows = await tx
    .select({ quorumRule: committees.quorumRule })
    .from(committees)
    .where(and(eq(committees.id, committeeId), eq(committees.tenantId, tenantId)))
    .limit(1);
  const committee = committeeRows[0];
  if (!committee) return null;
  const rule = committee.quorumRule as QuorumRule;

  const activeMembers = await getActiveMemberIds(tx, committeeId, tenantId);
  const attendance = await tx
    .select({ status: attendanceRecords.status, mode: attendanceRecords.mode })
    .from(attendanceRecords)
    .where(and(eq(attendanceRecords.meetingId, meetingId), eq(attendanceRecords.tenantId, tenantId)));

  const membersPresent = countQuorumEligible(attendance, rule);
  const requiredQuorum = requiredQuorumCount(rule, activeMembers.length);
  return { membersPresent, requiredQuorum };
}

/**
 * Assign the sequential resolution number scoped to a committee + financial year (Req 11.4, P25).
 * Reads the concluded resolutions already numbered in that scope, derives the next sequence via
 * the decision-domain helper, and formats the canonical number. The DB
 * `UNIQUE(tenant_id, meeting_id, resolution_number)` index is the ultimate guard against races.
 */
async function assignResolutionNumber(
  tx: DrizzleTx,
  tenantId: string,
  meeting: { id: string; committeeId: string | null },
  when: Date,
): Promise<string> {
  const financialYear = resolutionFinancialYear(when);

  let committeeCode: string | null = null;
  let scopeMeetingIds: string[] = [meeting.id];
  if (meeting.committeeId) {
    const committeeRows = await tx
      .select({ code: committees.code })
      .from(committees)
      .where(and(eq(committees.id, meeting.committeeId), eq(committees.tenantId, tenantId)))
      .limit(1);
    committeeCode = committeeRows[0]?.code ?? null;

    const meetingRows = await tx
      .select({ id: meetings.id })
      .from(meetings)
      .where(and(eq(meetings.committeeId, meeting.committeeId), eq(meetings.tenantId, tenantId)));
    scopeMeetingIds = meetingRows.map((m) => m.id);
  }

  const numbered = await tx
    .select({
      resolutionNumber: resolutions.resolutionNumber,
      effectiveDate: resolutions.effectiveDate,
      createdAt: resolutions.createdAt,
    })
    .from(resolutions)
    .where(
      and(
        eq(resolutions.tenantId, tenantId),
        inArray(resolutions.meetingId, scopeMeetingIds.length > 0 ? scopeMeetingIds : [meeting.id]),
        eq(resolutions.isCirculation, false),
      ),
    );

  // Only count already-concluded (numbered) resolutions from the same financial year. Rows still
  // open for voting carry a `PENDING-<id>` placeholder and are skipped by the FY / prefix parse.
  const existingSequences: number[] = [];
  for (const row of numbered) {
    const seq = parseResolutionSequence(row.resolutionNumber);
    if (seq === null) continue;
    const rowDate = row.effectiveDate ? new Date(row.effectiveDate) : row.createdAt;
    if (rowDate && resolutionFinancialYear(rowDate) === financialYear) {
      existingSequences.push(seq);
    }
  }

  const sequence = nextResolutionSequence(existingSequences);
  return generateResolutionNumber({ committeeCode, financialYear, sequence });
}

/** Extract the trailing numeric sequence from a canonical resolution number, else null. */
function parseResolutionSequence(resolutionNumber: string): number | null {
  const last = resolutionNumber.split("/").pop();
  if (!last) return null;
  const n = Number.parseInt(last, 10);
  return Number.isFinite(n) ? n : null;
}

/** SHA-256 hex of the resolution content — the integrity anchor for DSC/QR verification (P24). */
function resolutionContentHash(input: {
  resolutionNumber: string;
  text: string;
  result: string;
  votesFor: number;
  votesAgainst: number;
  votesAbstain: number;
}): string {
  return createHash("sha256")
    .update(
      [
        input.resolutionNumber,
        input.text,
        input.result,
        input.votesFor,
        input.votesAgainst,
        input.votesAbstain,
      ].join("|"),
    )
    .digest("hex");
}

/** Recompute the live tally from the recorded ballots and prime the 30s TTL cache (Req 11.3). */
async function refreshTallyCache(tenantId: string, resolutionId: string, isCirculation: boolean): Promise<void> {
  const rows = await scopedRead((tx) => tx
    .select({ position: votes.position })
    .from(votes)
    .where(
      and(
        eq(votes.resolutionId, resolutionId),
        eq(votes.tenantId, tenantId),
        eq(votes.isCirculation, isCirculation),
      ),
    ));
  const positions = isCirculation ? rows.map((r) => normalizeCirculationPosition(r.position)) : rows.map((r) => r.position);
  const tally = computeTally(positions);
  await cache.put(cache.makeKey(tenantId, TALLY_RESOURCE, resolutionId), tally, TALLY_TTL_SECONDS);
}

/** Map a circulation position (approve/reject/abstain) onto the tally vocabulary (for/against/abstain). */
function normalizeCirculationPosition(position: string): string {
  if (position === "approve") return "for";
  if (position === "reject") return "against";
  return "abstain";
}

/** Best-effort invalidation of the vote read caches after a write commits. */
async function invalidateVoteCaches(tenantId: string, meetingId: string | null, resolutionId: string): Promise<void> {
  await cache.invalidate(cache.makeKey(tenantId, CACHE_RESOURCE, resolutionId));
  if (meetingId) await cache.invalidate(cache.makeKey(tenantId, CACHE_RESOURCE, meetingId));
  await cache.invalidateResource(tenantId, CACHE_RESOURCE);
}

// ─── Handlers ──────────────────────────────────────────────────────────────────

/**
 * meeting.vote.initiate — re-verify quorum, open a resolution for voting (Req 11.1, 11.2),
 * notify members, emit `vote.initiated`.
 */
async function handleVoteInitiate(msg: CommandEnvelope<VoteInitiatePayload>): Promise<void> {
  const p = msg.payload;
  await db.transaction(async (tx) => {
    if (!(await markProcessed(tx, msg.messageId))) return;

    const meeting = await getMeeting(tx, p.meetingId, msg.tenantId);
    if (!meeting) throw new NonRetryableError(`meeting ${p.meetingId} not found`);

    // Req 11.2: quorum must still be met at vote time. A lost quorum is permanent for this
    // message (retrying will not change the recorded attendance) → route to DLQ.
    try {
      const quorum = await computeVoteTimeQuorum(tx, p.meetingId, msg.tenantId, meeting.committeeId);
      if (quorum) {
        assertQuorumAtVoteTime({ membersPresent: quorum.membersPresent, requiredQuorum: quorum.requiredQuorum });
      } else if (!meeting.quorumEstablished) {
        throw httpError("MEETING_QUORUM_NOT_MET", "quorum is not established; cannot initiate vote", {
          meetingId: p.meetingId,
        });
      }
    } catch (err) {
      throw new NonRetryableError(err instanceof Error ? err.message : String(err), err);
    }

    // Config-driven threshold (Gap 4): when the initiator did not name a majority rule, fall
    // back to the tenant's configured `voting.default_threshold` (default simple_majority).
    const requestedRule = p.majorityRule && p.majorityRule.trim().length > 0 ? p.majorityRule : undefined;
    const configuredDefault = requestedRule ?? (await getPolicyString(tx, msg.tenantId, "voting.default_threshold"));
    const majorityRule = isMajorityRule(configuredDefault) ? configuredDefault : "simple_majority";

    await tx.insert(resolutions).values({
      id: p.resolutionId,
      tenantId: p.tenantId,
      meetingId: p.meetingId,
      decisionId: p.decisionId ?? null,
      // Provisional, unique-per-meeting placeholder; the real number is assigned on conclude.
      resolutionNumber: `PENDING-${p.resolutionId}`,
      text: p.resolutionText,
      voteType: p.voteType,
      majorityRule,
      result: RESULT_PENDING,
      status: STATUS_VOTING_OPEN,
      isCirculation: false,
      effectiveDate: p.effectiveDate ?? null,
      createdBy: msg.actorId,
      updatedBy: msg.actorId,
    });

    await enqueue(tx, {
      topic: EVENTS.voteInitiated,
      eventType: EVENTS.voteInitiated,
      tenantId: msg.tenantId,
      actorId: msg.actorId,
      correlationId: msg.correlationId,
      payload: { meetingId: p.meetingId, resolutionId: p.resolutionId, voteType: p.voteType },
    });

    const memberIds = meeting.committeeId
      ? await getActiveMemberIds(tx, meeting.committeeId, msg.tenantId)
      : [];
    await notifyMembers(tx, msg, memberIds, EVENTS.voteInitiated, {
      resolutionId: p.resolutionId,
      meetingId: p.meetingId,
    });
    await audit(tx, msg, "vote_initiate", p.resolutionId);
  });

  await invalidateVoteCaches(msg.tenantId, p.meetingId, p.resolutionId);
}

/**
 * meeting.vote.cast — record one member's ballot (Req 11.3), increment the resolution's running
 * counts race-safely, and refresh the 30s tally cache. Duplicate ballots (P17) and votes on a
 * closed resolution are permanent rejections → DLQ.
 */
async function handleVoteCast(msg: CommandEnvelope<VoteCastPayload>): Promise<void> {
  const p = msg.payload;
  await db.transaction(async (tx) => {
    if (!(await markProcessed(tx, msg.messageId))) return;

    const resolution = await getResolution(tx, p.resolutionId, msg.tenantId);
    if (!resolution) throw new NonRetryableError(`resolution ${p.resolutionId} not found`);
    if (resolution.isCirculation) {
      throw new NonRetryableError(`resolution ${p.resolutionId} is a circulation resolution; use circulation_respond`);
    }
    if (resolution.status !== STATUS_VOTING_OPEN) {
      throw new NonRetryableError(`resolution ${p.resolutionId} is not open for voting (status=${resolution.status})`);
    }

    // Duplicate-vote pre-check (P17) — complements the DB UNIQUE(resolution_id, member_id).
    const voters = await tx
      .select({ memberId: votes.memberId })
      .from(votes)
      .where(and(eq(votes.resolutionId, p.resolutionId), eq(votes.tenantId, msg.tenantId)));
    try {
      assertNoDuplicateVote(
        voters.map((v) => v.memberId),
        p.memberId,
      );
    } catch (err) {
      throw new NonRetryableError(err instanceof Error ? err.message : String(err), err);
    }

    // Recusal enforcement (Gap 1): a member recused on this motion cannot cast a vote — the
    // ballot is rejected and the member never enters the tally. Permanent → DLQ.
    const recusedRows = await tx
      .select({ memberId: recusals.memberId })
      .from(recusals)
      .where(and(eq(recusals.resolutionId, p.resolutionId), eq(recusals.tenantId, msg.tenantId)));
    try {
      assertNotRecused(recusedRows.map((r) => r.memberId), p.memberId);
    } catch (err) {
      throw new NonRetryableError(err instanceof Error ? err.message : String(err), err);
    }

    // Weighted voting (Gap 2): capture the member's per-seat weight onto the ballot so the
    // weighted tally sums without re-joining the roster. Defaults to 1 (headcount) when unset.
    const meetingForWeight = await getMeeting(tx, p.meetingId, msg.tenantId);
    const weight = await getMemberVoteWeight(tx, msg.tenantId, meetingForWeight?.committeeId ?? null, p.memberId);

    await tx.insert(votes).values({
      id: randomUUID(),
      tenantId: p.tenantId,
      resolutionId: p.resolutionId,
      memberId: p.memberId,
      position: p.position,
      reason: p.reason ?? null,
      weight,
      isCirculation: false,
    });

    // Race-safe increment of the running count for the cast position (no lost updates under
    // concurrent casts). The authoritative tally is recomputed from the votes at conclude.
    const set: PgUpdateSetSource<typeof resolutions> = {
      updatedBy: msg.actorId,
      updatedAt: new Date(),
      ...(p.position === "for" ? { votesFor: sql`${resolutions.votesFor} + 1` } : {}),
      ...(p.position === "against" ? { votesAgainst: sql`${resolutions.votesAgainst} + 1` } : {}),
      ...(p.position === "abstain" ? { votesAbstain: sql`${resolutions.votesAbstain} + 1` } : {}),
    };
    await tx
      .update(resolutions)
      .set(set)
      .where(and(eq(resolutions.id, p.resolutionId), eq(resolutions.tenantId, msg.tenantId)));

    await audit(tx, msg, "vote_cast", p.resolutionId, { position: p.position });
  });

  await refreshTallyCache(msg.tenantId, p.resolutionId, false);
  await invalidateVoteCaches(msg.tenantId, p.meetingId, p.resolutionId);
}

/**
 * meeting.vote.conclude — tally the ballots, compute the result per the configured majority rule
 * (Req 11.4), assign the sequential resolution number, anchor the content hash when passed
 * (Req 11.5), and emit `vote.concluded` + `resolution.passed`/`resolution.rejected`.
 */
async function handleVoteConclude(msg: CommandEnvelope<VoteConcludePayload>): Promise<void> {
  const p = msg.payload;
  await db.transaction(async (tx) => {
    if (!(await markProcessed(tx, msg.messageId))) return;

    const resolution = await getResolution(tx, p.resolutionId, msg.tenantId);
    if (!resolution) throw new NonRetryableError(`resolution ${p.resolutionId} not found`);
    if (resolution.isCirculation) {
      throw new NonRetryableError(`resolution ${p.resolutionId} is a circulation resolution; conclude via circulation flow`);
    }
    if (resolution.status !== STATUS_VOTING_OPEN) return; // already concluded — idempotent no-op

    const meeting = await getMeeting(tx, resolution.meetingId, msg.tenantId);

    const voteRows = await tx
      .select({ position: votes.position, weight: votes.weight })
      .from(votes)
      .where(
        and(
          eq(votes.resolutionId, p.resolutionId),
          eq(votes.tenantId, msg.tenantId),
          eq(votes.isCirculation, false),
        ),
      );
    // Headcount tally is ALWAYS the authoritative votes_for/_against/_abstain (P14 invariant).
    const tally = computeTally(voteRows.map((v) => v.position));

    // Weighted voting (Gap 2): when the tenant enables `voting.weighted_enabled`, the RESULT is
    // decided on summed WEIGHT, not headcount. Otherwise the headcount tally decides (unchanged).
    const weightedEnabled = await getPolicyBool(tx, msg.tenantId, "voting.weighted_enabled");
    const weightedTally = weightedEnabled
      ? computeWeightedTally(voteRows.map((v) => ({ position: v.position, weight: v.weight })))
      : null;
    const resultTally = weightedTally ?? tally;

    const rule = isMajorityRule(resolution.majorityRule) ? resolution.majorityRule : "simple_majority";
    const result = computeVoteResult(resultTally, rule);
    const passed = result === "passed";

    const when = p.effectiveDate ? new Date(p.effectiveDate) : new Date();
    const resolutionNumber = await assignResolutionNumber(
      tx,
      msg.tenantId,
      { id: resolution.meetingId, committeeId: meeting?.committeeId ?? null },
      when,
    );

    const effectiveDate = p.effectiveDate ?? resolution.effectiveDate ?? (passed ? isoDate(when) : null);
    const hashCurrent = passed
      ? resolutionContentHash({
          resolutionNumber,
          text: resolution.text,
          result,
          votesFor: tally.votesFor,
          votesAgainst: tally.votesAgainst,
          votesAbstain: tally.votesAbstain,
        })
      : null;

    const set: PgUpdateSetSource<typeof resolutions> = {
      votesFor: tally.votesFor,
      votesAgainst: tally.votesAgainst,
      votesAbstain: tally.votesAbstain,
      result,
      resolutionNumber,
      status: passed ? STATUS_EFFECTIVE : STATUS_REJECTED,
      effectiveDate,
      updatedBy: msg.actorId,
      updatedAt: new Date(),
      ...(hashCurrent ? { hashCurrent } : {}),
      ...(weightedTally
        ? {
            weightFor: weightedTally.votesFor,
            weightAgainst: weightedTally.votesAgainst,
            weightAbstain: weightedTally.votesAbstain,
          }
        : {}),
    };
    await versionedUpdate(tx, resolutions, {
      id: resolution.id,
      tenantId: msg.tenantId,
      expectedVersion: resolution.version,
      set,
      entity: "resolution",
    });

    await enqueue(tx, {
      topic: EVENTS.voteConcluded,
      eventType: EVENTS.voteConcluded,
      tenantId: msg.tenantId,
      actorId: msg.actorId,
      correlationId: msg.correlationId,
      payload: { meetingId: resolution.meetingId, resolutionId: resolution.id, result },
    });
    await enqueue(tx, {
      topic: passed ? EVENTS.resolutionPassed : EVENTS.resolutionRejected,
      eventType: passed ? EVENTS.resolutionPassed : EVENTS.resolutionRejected,
      tenantId: msg.tenantId,
      actorId: msg.actorId,
      correlationId: msg.correlationId,
      payload: {
        resolutionId: resolution.id,
        meetingId: resolution.meetingId,
        resolutionNumber,
        votesFor: tally.votesFor,
        votesAgainst: tally.votesAgainst,
        votesAbstain: tally.votesAbstain,
      },
    });
    await audit(tx, msg, "vote_conclude", resolution.id, { result, resolutionNumber });
  });

  await invalidateVoteCaches(msg.tenantId, p.meetingId, p.resolutionId);
}

/**
 * meeting.vote.circulation_respond — record one member's asynchronous response to a circulation
 * resolution (Req 12.3), then conclude the circulation once every member has responded or the
 * deadline has passed (Req 12.4): compute the outcome (invalid if the response rate is below the
 * configured minimum, P18), record it, and emit `resolution.circulation_completed`.
 */
async function handleCirculationRespond(msg: CommandEnvelope<CirculationRespondPayload>): Promise<void> {
  const p = msg.payload;
  let meetingIdForCache: string | null = null;

  await db.transaction(async (tx) => {
    if (!(await markProcessed(tx, msg.messageId))) return;

    const resolution = await getResolution(tx, p.resolutionId, msg.tenantId);
    if (!resolution) throw new NonRetryableError(`resolution ${p.resolutionId} not found`);
    if (!resolution.isCirculation) {
      throw new NonRetryableError(`resolution ${p.resolutionId} is not a circulation resolution`);
    }
    if (TERMINAL_STATUSES.has(resolution.status)) return; // already concluded — idempotent no-op
    meetingIdForCache = resolution.meetingId;

    // Duplicate-response pre-check (P17): one response per member per circulation resolution.
    const responders = await tx
      .select({ memberId: votes.memberId })
      .from(votes)
      .where(
        and(
          eq(votes.resolutionId, p.resolutionId),
          eq(votes.tenantId, msg.tenantId),
          eq(votes.isCirculation, true),
        ),
      );
    try {
      assertNoDuplicateVote(
        responders.map((r) => r.memberId),
        p.memberId,
      );
    } catch (err) {
      throw new NonRetryableError(err instanceof Error ? err.message : String(err), err);
    }

    await tx.insert(votes).values({
      id: randomUUID(),
      tenantId: p.tenantId,
      resolutionId: p.resolutionId,
      memberId: p.memberId,
      position: p.position,
      reason: p.comment ?? null,
      isCirculation: true,
    });

    const meeting = await getMeeting(tx, resolution.meetingId, msg.tenantId);
    const totalMembers = meeting?.committeeId
      ? (await getActiveMemberIds(tx, meeting.committeeId, msg.tenantId)).length
      : 0;

    // Recompute the response tally from the recorded circulation ballots (this one included).
    const allResponses = await tx
      .select({ position: votes.position })
      .from(votes)
      .where(
        and(
          eq(votes.resolutionId, p.resolutionId),
          eq(votes.tenantId, msg.tenantId),
          eq(votes.isCirculation, true),
        ),
      );
    let approve = 0;
    let reject = 0;
    let abstain = 0;
    for (const r of allResponses) {
      if (r.position === "approve") approve += 1;
      else if (r.position === "reject") reject += 1;
      else abstain += 1;
    }
    const responded = allResponses.length;

    // Req 12.4: conclude when everyone has responded or the deadline has passed (whichever first).
    const deadlinePassed = resolution.circulationDeadline
      ? new Date() >= resolution.circulationDeadline
      : false;
    const allResponded = totalMembers > 0 && responded >= totalMembers;

    if (deadlinePassed || allResponded) {
      const rule = isMajorityRule(resolution.majorityRule) ? resolution.majorityRule : "simple_majority";
      const outcome = computeCirculationResult({
        approveCount: approve,
        rejectCount: reject,
        abstainCount: abstain,
        totalMembers,
        majorityRule: rule,
      });
      const status =
        outcome.result === "passed" ? STATUS_EFFECTIVE : outcome.result === "invalid" ? STATUS_INVALID : STATUS_REJECTED;

      await versionedUpdate(tx, resolutions, {
        id: resolution.id,
        tenantId: msg.tenantId,
        expectedVersion: resolution.version,
        set: {
          votesFor: approve,
          votesAgainst: reject,
          votesAbstain: abstain,
          result: outcome.result,
          responseRate: outcome.responseRate,
          status,
          updatedBy: msg.actorId,
          updatedAt: new Date(),
        },
        entity: "resolution",
      });

      await enqueue(tx, {
        topic: EVENTS.circulationResolutionCompleted,
        eventType: EVENTS.circulationResolutionCompleted,
        tenantId: msg.tenantId,
        actorId: msg.actorId,
        correlationId: msg.correlationId,
        payload: {
          resolutionId: resolution.id,
          committeeId: meeting?.committeeId ?? null,
          result: outcome.result,
          responseRate: outcome.responseRate,
        },
      });

      // Req 12.5: an invalid circulation (response rate below minimum) alerts the secretary to
      // bring the matter to the next meeting.
      if (!outcome.valid) {
        await enqueue(tx, {
          topic: EVENTS.complianceAlert,
          eventType: EVENTS.complianceAlert,
          tenantId: msg.tenantId,
          actorId: msg.actorId,
          correlationId: msg.correlationId,
          payload: {
            meetingId: resolution.meetingId,
            committeeId: meeting?.committeeId ?? null,
            alertType: "circulation_resolution_invalid",
            detail: { resolutionId: resolution.id, responseRate: outcome.responseRate },
          },
        });
      }
      await audit(tx, msg, "circulation_conclude", resolution.id, { result: outcome.result });
    } else {
      await audit(tx, msg, "circulation_respond", resolution.id, { position: p.position });
    }
  });

  await refreshTallyCache(msg.tenantId, p.resolutionId, true);
  await invalidateVoteCaches(msg.tenantId, meetingIdForCache, p.resolutionId);
}

/**
 * meeting.vote.recuse — record a member's conflict-of-interest recusal on a motion (Gap 1).
 * Only valid while the motion is open; a member who has already voted cannot recuse. The recusal
 * is stored (idempotently, one per resolution+member) so it appears in the vote record / minutes,
 * emits `vote.recusal_recorded`, and thereafter bars the member's ballot on this motion and
 * excludes them from its quorum-for-that-item denominator.
 */
async function handleVoteRecuse(msg: CommandEnvelope<VoteRecusePayload>): Promise<void> {
  const p = msg.payload;
  await db.transaction(async (tx) => {
    if (!(await markProcessed(tx, msg.messageId))) return;

    const resolution = await getResolution(tx, p.resolutionId, msg.tenantId);
    if (!resolution) throw new NonRetryableError(`resolution ${p.resolutionId} not found`);
    if (resolution.status !== STATUS_VOTING_OPEN && resolution.status !== STATUS_CIRCULATING) {
      throw new NonRetryableError(`resolution ${p.resolutionId} is not open for recusal (status=${resolution.status})`);
    }

    // A member who already cast a ballot on this motion cannot then recuse from it.
    const already = await tx
      .select({ memberId: votes.memberId })
      .from(votes)
      .where(and(eq(votes.resolutionId, p.resolutionId), eq(votes.tenantId, msg.tenantId), eq(votes.memberId, p.memberId)))
      .limit(1);
    if (already.length > 0) {
      throw new NonRetryableError(`member ${p.memberId} has already voted on ${p.resolutionId}; cannot recuse`);
    }

    await tx
      .insert(recusals)
      .values({
        id: randomUUID(),
        tenantId: p.tenantId,
        resolutionId: p.resolutionId,
        meetingId: p.meetingId,
        memberId: p.memberId,
        agendaItemId: p.agendaItemId ?? null,
        reason: p.reason,
        registerRef: p.registerRef ?? null,
        recordedBy: msg.actorId,
      })
      .onConflictDoNothing();

    await enqueue(tx, {
      topic: EVENTS.voteRecusalRecorded,
      eventType: EVENTS.voteRecusalRecorded,
      tenantId: msg.tenantId,
      actorId: msg.actorId,
      correlationId: msg.correlationId,
      payload: { meetingId: p.meetingId, resolutionId: p.resolutionId, memberId: p.memberId },
    });
    await audit(tx, msg, "vote_recuse", p.resolutionId, { memberId: p.memberId });
  });

  await invalidateVoteCaches(msg.tenantId, p.meetingId, p.resolutionId);
}

// ─── Circulation reminders (Req 12.6) ────────────────────────────────────────────

/**
 * The two reminder instants for a circulation resolution: 50% and 80% of the voting-deadline
 * window `[startAt, deadline)` (Req 12.6). Pure and deterministic. The scheduled reminder worker
 * (task 20) polls open circulation resolutions and, when `now` crosses one of these instants,
 * publishes `notification.send` reminders to the members who have not yet responded.
 */
export function circulationReminderTimes(startAt: Date, deadline: Date): { at50Pct: Date; at80Pct: Date } {
  const start = startAt.getTime();
  const windowMs = Math.max(0, deadline.getTime() - start);
  return {
    at50Pct: new Date(start + Math.floor(windowMs * 0.5)),
    at80Pct: new Date(start + Math.floor(windowMs * 0.8)),
  };
}

// ─── Registration ──────────────────────────────────────────────────────────────

/** A topic → handler registrar (structurally compatible with the worker's `registerConsumer`). */
export type RegisterConsumer = <T = unknown>(
  topic: string,
  handler: (msg: CommandEnvelope<T>) => Promise<void>,
) => void;

/**
 * Register every voting command handler. worker.ts (task 19.1) calls this with its
 * `registerConsumer`, wiring the voting COMMANDS topics to the handlers above.
 */
export function registerVotingConsumers(register: RegisterConsumer): void {
  register(COMMANDS.voteInitiate, handleVoteInitiate);
  register(COMMANDS.voteCast, handleVoteCast);
  register(COMMANDS.voteConclude, handleVoteConclude);
  register(COMMANDS.voteCirculationRespond, handleCirculationRespond);
  register(COMMANDS.voteRecuse, handleVoteRecuse);
}
