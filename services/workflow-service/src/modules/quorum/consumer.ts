import type { Queue } from "@civitasone/queue";
import { pino } from "pino";
import { db } from "../../shared/db.js";
import { enqueue, markProcessed } from "../../shared/outbox.js";
import { COMMANDS } from "../../topics.js";
import * as repo from "./repo.js";
import type { QuorumRule, VoteChoice } from "./domain.js";

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
        await repo.createDecision({
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
        await repo.castVote(p.tenantId, p.id, msg.actorId, p.vote, p.reason, msg.actorId, msg.correlationId);
        await enqueue(tx, { topic: AUDIT_TOPIC, eventType: AUDIT_TOPIC, tenantId: msg.tenantId, actorId: msg.actorId, correlationId: msg.correlationId, payload: { service: "workflow-service", action: "cast_vote", resourceType: "committee_vote", resourceId: p.id, outcome: "success" } });
      });
    } catch (err) { log.error({ err, messageId: msg.messageId }, "castCommitteeVote failed"); throw err; }
  });
}
