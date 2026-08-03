import type { CommandEnvelope } from "@civitasone/queue";
import { db } from "../../shared/db.js";
import { enqueue, markProcessed } from "../../shared/outbox.js";
import { writeAudit } from "../../shared/audit.js";
import { cache } from "../../shared/infra.js";
import { EVENTS } from "../../topics.js";
import * as repo from "./repo.js";
import { classifyHealth, type HealthFactors } from "./domain.js";

function ctxOf(msg: { tenantId: string; actorId: string; correlationId: string }) {
  return { tenantId: msg.tenantId, actorId: msg.actorId, correlationId: msg.correlationId };
}

export interface HealthRecomputePayload {
  id: string;
  accountId: string;
  score: number;
  factors: HealthFactors;
  computedAt: string;
}

export async function handleHealthRecompute(
  msg: CommandEnvelope<HealthRecomputePayload>,
): Promise<void> {
  const p = msg.payload;
  await db.transaction(async (tx) => {
    if (!(await markProcessed(tx, msg.messageId))) return;
    await repo.insert(tx, {
      id: p.id,
      tenantId: msg.tenantId,
      accountId: p.accountId,
      score: p.score,
      factors: p.factors,
      computedAt: new Date(p.computedAt),
      createdBy: msg.actorId,
      updatedBy: msg.actorId,
    });
    await enqueue(tx, {
      topic: EVENTS.healthScoreUpdated,
      eventType: EVENTS.healthScoreUpdated,
      tenantId: msg.tenantId,
      actorId: msg.actorId,
      correlationId: msg.correlationId,
      payload: {
        healthScoreId: p.id,
        accountId: p.accountId,
        score: p.score,
        classification: classifyHealth(p.score),
      },
    });
    await writeAudit(tx, ctxOf(msg), {
      action: "health.recompute",
      resourceType: "health_score",
      resourceId: p.id,
    });
  });
  await cache.invalidate(cache.makeKey(msg.tenantId, "health", p.accountId));
}
