import type { Queue } from "@civitasone/queue";
import { pino } from "pino";
import { captureError } from "@civitasone/observability";
import { db } from "../../shared/db.js";
import { enqueue, markProcessed } from "../../shared/outbox.js";
import { COMMANDS } from "../../topics.js";
import * as repo from "./repo.js";
import type { QuorumRule, VoteChoice } from "./domain.js";

const SERVICE = "workflow-service";

const AUDIT_TOPIC = "audit.event.record";

const log = pino({ name: "workflow-quorum-consumer" });

export function registerQuorumConsumers(queue: Queue): void {
  queue.subscribe(COMMANDS.createCommitteeDecision, async (msg) => {
    const p = msg.payload as {
      id: string; tenantId: string; instanceId: string | null; taskId: string | null; nodeKey: string | null;
      subject: string; rule: QuorumRule; threshold: number | null; totalMembers: number;
    };
    try {
      await db.transaction(async (tx) => {
        if (!(await markProcessed(tx, msg.messageId))) return;
        // repo.createDecision opens its own tx; keep markProcessed durable first then write.
        // To keep atomicity, perform insert here via repo only if we nest — use direct path:
        // id: p.id -- the accepted-response id (see repo.createDecision doc): without
        // forwarding it here the row got a fresh defaultRandom() id instead, and the
        // id returned to the HTTP caller never matched anything in the database.
        await repo.createDecisionTx(tx, {
          id: p.id, tenantId: p.tenantId, instanceId: p.instanceId, taskId: p.taskId, nodeKey: p.nodeKey,
          subject: p.subject, rule: p.rule, threshold: p.threshold, totalMembers: p.totalMembers,
          createdBy: msg.actorId,
        });
        await enqueue(tx, { topic: AUDIT_TOPIC, eventType: AUDIT_TOPIC, tenantId: msg.tenantId, actorId: msg.actorId, correlationId: msg.correlationId, payload: { service: "workflow-service", action: "process", resourceType: "quorum", resourceId: p.tenantId, outcome: "success" } });
      });
    } catch (err) { log.error({ err, messageId: msg.messageId }, "createCommitteeDecision failed"); throw err; }
  });

  queue.subscribe(COMMANDS.castCommitteeVote, async (msg) => {
    const p = msg.payload as { id: string; tenantId: string; vote: VoteChoice; reason: string | null };
    try {
      await db.transaction(async (tx) => {
        if (!(await markProcessed(tx, msg.messageId))) return;
        const result = await repo.castVoteTx(tx, p.tenantId, p.id, msg.actorId, p.vote, p.reason, msg.actorId, msg.correlationId);
        // REL-031: a vote from a voter who had NOT already voted, arriving
        // after the decision was already `decided` by someone else, used to
        // vanish right here -- castVoteTx's return value was never even
        // inspected. `lateVote` (see repo.ts's VoteResult doc) makes that
        // case explicit; surface it via captureError() -- this codebase's
        // established "make an invisible failure visible without deciding
        // its deeper handling" primitive (same one the depreciation
        // consumer's REL-026 fix uses for the analogous silent-miss shape)
        // -- plus a non-"success" audit outcome, instead of the queue
        // driver's NonRetryableError/DLQ path (see castVoteTx's comment for
        // why: no local precedent for throwing on an expected outcome here,
        // and throwing would roll back markProcessed(), which is itself a
        // real behavioral choice the deeper "should a late vote ever count"
        // product question has not settled). This does NOT decide whether a
        // late vote should count -- only that it can never again be silent.
        if (!("notFound" in result) && result.lateVote) {
          captureError(
            new Error("cast_committee_vote: vote arrived after the decision had already settled"),
            {
              service: SERVICE, topic: COMMANDS.castCommitteeVote, messageId: msg.messageId,
              decisionId: p.id, tenantId: p.tenantId, voterId: msg.actorId,
              decisionStatus: result.decision.status,
            },
          );
          await enqueue(tx, { topic: AUDIT_TOPIC, eventType: AUDIT_TOPIC, tenantId: msg.tenantId, actorId: msg.actorId, correlationId: msg.correlationId, payload: { service: SERVICE, action: "cast_vote", resourceType: "committee_vote", resourceId: p.id, outcome: "rejected_already_decided" } });
          return;
        }
        await enqueue(tx, { topic: AUDIT_TOPIC, eventType: AUDIT_TOPIC, tenantId: msg.tenantId, actorId: msg.actorId, correlationId: msg.correlationId, payload: { service: SERVICE, action: "cast_vote", resourceType: "committee_vote", resourceId: p.id, outcome: "success" } });
      });
    } catch (err) { log.error({ err, messageId: msg.messageId }, "castCommitteeVote failed"); throw err; }
  });
}
