import { pino } from "pino";
import type { Queue } from "@civitasone/queue";
import { db } from "../../shared/db.js";
import { enqueue, markProcessed } from "../../shared/outbox.js";
import { writeAudit } from "../../shared/audit.js";
import { cache } from "../../shared/infra.js";
import { tenantScoped } from "../../shared/tenant-queue.js";
import { COMMANDS, EVENTS } from "../../topics.js";
import * as repo from "./repo.js";
import * as profilesRepo from "../profiles/repo.js";
import * as identityRepo from "../identity/repo.js";
import { mergeProfiles } from "../profiles/domain.js";

const log = pino({ name: "cdp.steward.consumer" });

function ctxOf(msg: { tenantId: string; actorId: string; correlationId: string }) {
  return { tenantId: msg.tenantId, actorId: msg.actorId, correlationId: msg.correlationId };
}

export function registerStewardConsumers(rawQueue: Queue): void {
  const queue = tenantScoped(rawQueue);

  queue.subscribe(COMMANDS.decideMerge, async (msg) => {
    const p = msg.payload as {
      mergeRequestId: string;
      decision: "approve" | "reject";
      reason?: string;
      tenantId: string;
    };
    const decision = p.decision === "approve" ? "approved" : "rejected";
    let winnerId: string | null = null;
    let loserId: string | null = null;

    await db.transaction(async (tx) => {
      if (!(await markProcessed(tx, msg.messageId))) return;
      const mergeRequest = await repo.findById(p.mergeRequestId, msg.tenantId);
      if (!mergeRequest || mergeRequest.status !== "pending") return;

      const ok = await repo.decide(tx, p.mergeRequestId, msg.tenantId, decision, msg.actorId, p.reason);
      if (!ok) return;

      if (decision === "approved") {
        const winner = await profilesRepo.findByIdTx(tx, mergeRequest.sourceProfileId, msg.tenantId);
        const loser = await profilesRepo.findByIdTx(tx, mergeRequest.targetProfileId, msg.tenantId);
        if (winner && loser) {
          const { attributes, sourceLineage } = mergeProfiles(winner, loser);
          await profilesRepo.markMerged(
            tx, winner.id, loser.id, msg.tenantId, attributes, sourceLineage, loser.mergedFromIds,
          );
          await identityRepo.reassignProfile(tx, loser.id, winner.id, msg.tenantId);
          winnerId = winner.id;
          loserId = loser.id;
        }
      }

      await enqueue(tx, {
        topic: EVENTS.mergeDecided,
        eventType: EVENTS.mergeDecided,
        tenantId: msg.tenantId,
        actorId: msg.actorId,
        correlationId: msg.correlationId,
        payload: {
          mergeRequestId: p.mergeRequestId,
          decision,
          sourceProfileId: mergeRequest.sourceProfileId,
          targetProfileId: mergeRequest.targetProfileId,
        },
      });
      await writeAudit(tx, ctxOf(msg), {
        action: "steward.decide",
        resourceType: "merge_queue",
        resourceId: p.mergeRequestId,
        details: { decision },
      });
    });

    if (winnerId && loserId) {
      await cache.invalidate(cache.makeKey(msg.tenantId, "profile", winnerId));
      await cache.invalidate(cache.makeKey(msg.tenantId, "profile", loserId));
    }
    log.info({ id: p.mergeRequestId, decision }, "steward decision applied");
  });
}
