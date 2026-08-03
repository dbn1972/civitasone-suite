import type { CommandEnvelope } from "@civitasone/queue";
import { db } from "../../shared/db.js";
import { enqueue, markProcessed } from "../../shared/outbox.js";
import { writeAudit } from "../../shared/audit.js";
import { cache } from "../../shared/infra.js";
import { EVENTS } from "../../topics.js";
import * as repo from "./repo.js";

function ctxOf(msg: { tenantId: string; actorId: string; correlationId: string }) {
  return { tenantId: msg.tenantId, actorId: msg.actorId, correlationId: msg.correlationId };
}

export interface PredictiveUpsertPayload {
  id: string;
  subjectType: string;
  subjectId: string;
  modelType: string;
  score: string;
  confidence: string | null;
  modelVersion: string | null;
  features: Record<string, unknown>;
  computedAt: string;
}

export async function handlePredictiveUpsert(
  msg: CommandEnvelope<PredictiveUpsertPayload>,
): Promise<void> {
  const p = msg.payload;
  await db.transaction(async (tx) => {
    if (!(await markProcessed(tx, msg.messageId))) return;
    const rows = await repo.upsert(tx, {
      id: p.id,
      tenantId: msg.tenantId,
      subjectType: p.subjectType,
      subjectId: p.subjectId,
      modelType: p.modelType,
      score: p.score,
      confidence: p.confidence,
      modelVersion: p.modelVersion,
      features: p.features,
      computedAt: new Date(p.computedAt),
      createdBy: msg.actorId,
      updatedBy: msg.actorId,
    });
    const row = rows[0];
    if (row === undefined) return;
    await enqueue(tx, {
      topic: EVENTS.predictiveScoreUpserted,
      eventType: EVENTS.predictiveScoreUpserted,
      tenantId: msg.tenantId,
      actorId: msg.actorId,
      correlationId: msg.correlationId,
      payload: {
        scoreId: row.id,
        subjectType: p.subjectType,
        subjectId: p.subjectId,
        modelType: p.modelType,
        score: row.score,
        modelVersion: row.modelVersion,
      },
    });
    await writeAudit(tx, ctxOf(msg), {
      action: "predictive.upsert",
      resourceType: "predictive_score",
      resourceId: row.id,
    });
  });
  await cache.invalidate(cache.makeKey(msg.tenantId, "predictive", p.subjectId));
}
