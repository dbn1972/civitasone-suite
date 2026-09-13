import { and, eq, asc } from "drizzle-orm";
import { db, scopedRead } from "../../shared/db.js";

export type Writer = Pick<typeof db, "select" | "insert" | "update">;
import { enqueue } from "../../shared/outbox.js";
import { randomUUID } from "node:crypto";
import { EVENTS } from "../../topics.js";
import { committeeDecisions, committeeVotes, type CommitteeDecisionRow, type CommitteeVoteRow } from "./schema.js";
import { tallyQuorum, type QuorumRule, type VoteChoice, type QuorumTally } from "./domain.js";

export interface CreateDecisionInput {
  /**
   * The accepted-response id handed back to the HTTP caller (see
   * commands.ts's createCommitteeDecision). MUST be used as the row's
   * primary key -- omitting it (as this used to) left `id` on
   * committeeDecisions.defaultRandom(), so the id returned by POST
   * /committee-decisions never matched the row the consumer actually
   * created and callers had no reliable way to address the decision they
   * had just been told was "accepted".
   */
  id: string;
  tenantId: string;
  instanceId: string | null;
  taskId: string | null;
  nodeKey: string | null;
  subject: string;
  rule: QuorumRule;
  threshold: number | null;
  totalMembers: number;
  createdBy: string;
}

export async function createDecision(input: CreateDecisionInput): Promise<CommitteeDecisionRow> {
  return db.transaction((tx) => createDecisionTx(tx, input));
}

/** Tx-scoped twin of createDecision for callers already inside an open transaction. */
export async function createDecisionTx(tx: Writer, input: CreateDecisionInput): Promise<CommitteeDecisionRow> {
  const rows = await tx.insert(committeeDecisions).values({
    id: input.id,
    tenantId: input.tenantId,
    instanceId: input.instanceId,
    taskId: input.taskId,
    nodeKey: input.nodeKey,
    subject: input.subject,
    rule: input.rule,
    threshold: input.threshold,
    totalMembers: input.totalMembers,
    status: "open",
    createdBy: input.createdBy,
  }).returning();
  return rows[0]!;
}

export async function findDecision(id: string, tenantId: string): Promise<CommitteeDecisionRow | null> {
  const rows = await scopedRead((tx) => tx.select().from(committeeDecisions)
    .where(and(eq(committeeDecisions.id, id), eq(committeeDecisions.tenantId, tenantId))).limit(1));
  return rows[0] ?? null;
}

export async function listVotes(decisionId: string, tenantId: string): Promise<CommitteeVoteRow[]> {
  return scopedRead((tx) => tx.select().from(committeeVotes)
    .where(and(eq(committeeVotes.decisionId, decisionId), eq(committeeVotes.tenantId, tenantId)))
    .orderBy(asc(committeeVotes.createdAt)));
}

export interface DecisionWithVotes {
  decision: CommitteeDecisionRow;
  votes: CommitteeVoteRow[];
}

/**
 * REL-025 root cause and fix: findDecision() + listVotes() as two independent
 * scopedRead() calls are two independent READ COMMITTED statements. Under
 * concurrent load, a castVoteTx() commit landing in the gap between them
 * makes the second statement (votes) observe a later snapshot than the
 * first (decision) already read -- so a tally freshly computed from those
 * votes can legitimately show `decided: true` while `decision.status` is
 * still the pre-decision "open" row the first statement fetched a moment
 * earlier. Both reads are correct in isolation; they are just not reads of
 * the SAME moment.
 *
 * Confirmed live: castVoteTx's own write path is atomic and correct (traced
 * with logging on the exact 3rd/deciding vote -- the UPDATE always ran,
 * matched its `WHERE status = 'open'` predicate, returned the row with
 * status="decided", and the surrounding db.transaction() committed cleanly,
 * every single time). The inconsistency was reproducible ONLY when this
 * service's full test suite ran concurrently with ~90 other files against
 * the same disposable Postgres (roughly 3 of 4 runs; never in 40+ runs of
 * this file alone with zero contention) -- exactly the shape of contention
 * `turbo test --continue` produces in CI, which is consistent with the
 * bug's origin in a full-suite CI run.
 *
 * Fix: read the decision and its votes as ONE statement pair inside a
 * REPEATABLE READ transaction, which pins a single snapshot for the whole
 * transaction (unlike READ COMMITTED's default of a fresh snapshot per
 * statement) -- so `votes` can never reflect a commit that `decision`
 * missed. Bypasses scopedRead() (which does not accept an isolation-level
 * override) and calls db.transaction() directly; wrapWithTenantGuc's
 * override already forwards this second argument to the underlying
 * driver, so the tenant GUC is still set first exactly as scopedRead does.
 */
export async function findDecisionWithVotes(id: string, tenantId: string): Promise<DecisionWithVotes | null> {
  return db.transaction(async (tx) => {
    const rows = await tx.select().from(committeeDecisions)
      .where(and(eq(committeeDecisions.id, id), eq(committeeDecisions.tenantId, tenantId))).limit(1);
    const decision = rows[0];
    if (!decision) return null;
    const votes = await tx.select().from(committeeVotes)
      .where(and(eq(committeeVotes.decisionId, id), eq(committeeVotes.tenantId, tenantId)))
      .orderBy(asc(committeeVotes.createdAt));
    return { decision, votes };
  }, { isolationLevel: "repeatable read" });
}

export interface VoteResult {
  tally: QuorumTally;
  decision: CommitteeDecisionRow;
  duplicate: boolean;
  /**
   * REL-031: true when this vote came from a voter who had NOT already voted
   * (so `duplicate` is false) but the decision had already left "open" --
   * i.e. some other vote settled it first. The vote is NOT inserted (same
   * as before this fix); this flag exists purely so the caller can make
   * that fact visible instead of silently discarding it. See castVoteTx's
   * doc comment below for why this stays a returned flag rather than a
   * thrown error.
   */
  lateVote: boolean;
}

/**
 * Cast a vote and re-tally atomically under the decision row lock. A voter may
 * vote at most once (DB unique(decision_id, voter_id)); a repeat is reported as
 * duplicate rather than double-counted. When the fresh tally settles the
 * decision, we stamp outcome/status and emit a workflow event via the outbox.
 * Returns the updated tally + decision.
 */
export async function castVote(
  tenantId: string,
  decisionId: string,
  voterId: string,
  vote: VoteChoice,
  reason: string | null,
  actorId: string,
  correlationId: string,
): Promise<VoteResult | { notFound: true }> {
  return db.transaction((tx) => castVoteTx(tx, tenantId, decisionId, voterId, vote, reason, actorId, correlationId));
}

/** Tx-scoped twin of castVote for callers already inside an open transaction. */
export async function castVoteTx(
  tx: Writer,
  tenantId: string,
  decisionId: string,
  voterId: string,
  vote: VoteChoice,
  reason: string | null,
  actorId: string,
  correlationId: string,
): Promise<VoteResult | { notFound: true }> {
  const locked = await tx.select().from(committeeDecisions)
    .where(and(eq(committeeDecisions.id, decisionId), eq(committeeDecisions.tenantId, tenantId)))
    .for("update").limit(1);
  const decision = locked[0];
  if (!decision) return { notFound: true as const };

  // one-vote-per-voter idempotency
  const existing = await tx.select().from(committeeVotes)
    .where(and(eq(committeeVotes.decisionId, decisionId), eq(committeeVotes.voterId, voterId))).limit(1);
  let duplicate = false;
  let lateVote = false;
  if (existing[0]) {
    duplicate = true;
  } else if (decision.status === "open") {
    // REL-025 investigation note: this `status === "open"` guard means a vote
    // from a member who had not yet voted, arriving AFTER the decision row's
    // own lock is acquired but after some OTHER concurrent vote already
    // tipped the tally and flipped status to "decided", used to be silently
    // dropped here -- never inserted, not flagged `duplicate`, no error
    // surfaced. Verified live (5 concurrent distinct-voter votes on one
    // majority-5 decision, 10/10 trials): the decided transition itself is
    // reliable, but only the votes that land before the flip are ever
    // persisted. See docs/ENTERPRISE-GAP-REPORT-2026-09-07.md REL-025.
    await tx.insert(committeeVotes).values({ tenantId, decisionId, voterId, vote, reason });
  } else {
    // REL-031 fix: close the silent-drop gap the REL-025 note above
    // documented. This branch is reached only for a genuinely NEW voter
    // (not `duplicate`) whose vote arrives after `decision.status` already
    // left "open". The vote is still deliberately NOT inserted into
    // committee_votes here -- unchanged from before this fix -- because
    // whether a late vote should ever COUNT toward the tally (if the
    // decision were somehow reopened) is a committee-governance/product
    // call this fix does not make. `lateVote: true` on the return value is
    // ONLY the visibility half: it lets the caller (consumer.ts) surface
    // the drop via captureError() + a non-"success" audit outcome instead
    // of discarding it, mirroring the depreciation consumer's REL-026 fix
    // for the same shape of bug (a silent miss in an async CQRS consumer,
    // with the deeper handling-of-a-genuine-miss question deliberately left
    // open). A thrown/DLQ-routed error (the procurement tender/consumer.ts
    // NonRetryableError precedent for a bid arriving after a tender's
    // closing date) was deliberately NOT used here: unlike a late bid --
    // where "reject it outright" IS the settled product answer -- castVoteTx
    // itself already has an established local convention of signaling an
    // expected non-write outcome via a returned flag rather than a thrown
    // error (see `notFound` above and `duplicate` below), and throwing would
    // roll back this transaction's markProcessed() (forcing redelivery/DLQ),
    // which is itself a real behavioral choice the deeper product question
    // has not settled.
    lateVote = true;
  }

  const votes = await tx.select().from(committeeVotes)
    .where(eq(committeeVotes.decisionId, decisionId));
  const tally = tallyQuorum({
    rule: decision.rule as QuorumRule,
    totalMembers: decision.totalMembers,
    threshold: decision.threshold,
    votes: votes.map((v) => v.vote as VoteChoice),
  });

  let current = decision;
  if (tally.decided && decision.status === "open") {
    const upd = await tx.update(committeeDecisions)
      .set({ status: "decided", outcome: tally.outcome, decidedAt: new Date(), updatedAt: new Date() })
      .where(and(eq(committeeDecisions.id, decisionId), eq(committeeDecisions.status, "open")))
      .returning();
    current = upd[0] ?? decision;
    await enqueue(tx as Parameters<typeof enqueue>[0], {
      topic: EVENTS.committeeDecided,
      eventType: EVENTS.committeeDecided,
      tenantId,
      actorId,
      correlationId: correlationId || randomUUID(),
      payload: {
        decisionId,
        instanceId: decision.instanceId,
        taskId: decision.taskId,
        nodeKey: decision.nodeKey,
        rule: decision.rule,
        outcome: tally.outcome,
        approvals: tally.approvals,
        rejections: tally.rejections,
        totalMembers: decision.totalMembers,
      },
    });
  }
  return { tally, decision: current, duplicate, lateVote };
}
