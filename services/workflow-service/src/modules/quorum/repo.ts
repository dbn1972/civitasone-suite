import { and, eq, asc } from "drizzle-orm";
import { db, scopedRead } from "../../shared/db.js";
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
  const rows = await db.transaction((tx) =>
    tx.insert(committeeDecisions).values({
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
    }).returning(),
  );
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

export interface VoteResult {
  tally: QuorumTally;
  decision: CommitteeDecisionRow;
  duplicate: boolean;
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
  return db.transaction(async (tx) => {
    const locked = await tx.select().from(committeeDecisions)
      .where(and(eq(committeeDecisions.id, decisionId), eq(committeeDecisions.tenantId, tenantId)))
      .for("update").limit(1);
    const decision = locked[0];
    if (!decision) return { notFound: true as const };

    // one-vote-per-voter idempotency
    const existing = await tx.select().from(committeeVotes)
      .where(and(eq(committeeVotes.decisionId, decisionId), eq(committeeVotes.voterId, voterId))).limit(1);
    let duplicate = false;
    if (existing[0]) {
      duplicate = true;
    } else if (decision.status === "open") {
      await tx.insert(committeeVotes).values({ tenantId, decisionId, voterId, vote, reason });
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
    return { tally, decision: current, duplicate };
  });
}
