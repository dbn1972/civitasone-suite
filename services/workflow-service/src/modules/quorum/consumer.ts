import type { Queue } from "@civitasone/queue";
import { pino } from "pino";
import { db } from "../../shared/db.js";
import { markProcessed } from "../../shared/outbox.js";
import { COMMANDS } from "../../topics.js";
import * as repo from "./repo.js";
import type { QuorumRule, VoteChoice } from "./domain.js";

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
        await repo.createDecision({
          tenantId: p.tenantId, instanceId: p.instanceId, taskId: p.taskId, nodeKey: p.nodeKey,
          subject: p.subject, rule: p.rule, threshold: p.threshold, totalMembers: p.totalMembers,
          createdBy: msg.actorId,
        });
      });
    } catch (err) { log.error({ err, messageId: msg.messageId }, "createCommitteeDecision failed"); throw err; }
  });

  queue.subscribe(COMMANDS.castCommitteeVote, async (msg) => {
    const p = msg.payload as { id: string; tenantId: string; vote: VoteChoice; reason: string | null };
    try {
      await db.transaction(async (tx) => {
        if (!(await markProcessed(tx, msg.messageId))) return;
        await repo.castVote(p.tenantId, p.id, msg.actorId, p.vote, p.reason, msg.actorId, msg.correlationId);
      });
    } catch (err) { log.error({ err, messageId: msg.messageId }, "castCommitteeVote failed"); throw err; }
  });
}
