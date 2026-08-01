/**
 * intelligence/consumer.ts — F.6 handler for recommendation.intelligence.compute.
 *
 * The recompute is a command so the caller gets a 202 and the (potentially slow)
 * scoring never blocks the request. markProcessed() is the first statement in the
 * transaction so a redelivery cannot double-bump `version`.
 */
import type { CommandEnvelope } from "@civitasone/queue";
import { db } from "../../shared/db.js";
import { enqueue, markProcessed } from "../../shared/outbox.js";
import { cache } from "../../shared/infra.js";
import { EVENTS } from "../../topics.js";
import * as repo from "./repo.js";
import { computeOpportunityScore } from "./domain.js";
import type { RiskSignal, WhiteSpaceEntry } from "./schema.js";

export interface ComputeIntelligencePayload {
  intelligenceId: string;
  accountId: string;
  whiteSpace: WhiteSpaceEntry[];
  riskSignals: RiskSignal[];
}

export async function handleComputeIntelligence(
  msg: CommandEnvelope<ComputeIntelligencePayload>,
): Promise<void> {
  const p = msg.payload;
  // Recomputed here rather than trusting the command payload: the score is
  // derived data and the domain function is the single source of truth for it.
  const opportunityScore = computeOpportunityScore(p.whiteSpace, p.riskSignals);
  const lastComputedAt = new Date();

  await db.transaction(async (tx) => {
    const fresh = await markProcessed(tx, msg.messageId);
    if (!fresh) return;

    await repo.upsert(tx, {
      id: p.intelligenceId,
      tenantId: msg.tenantId,
      accountId: p.accountId,
      whiteSpace: p.whiteSpace,
      riskSignals: p.riskSignals,
      opportunityScore,
      lastComputedAt,
      createdBy: msg.actorId,
      updatedBy: msg.actorId,
    });

    await enqueue(tx, {
      topic: EVENTS.intelligenceComputed,
      eventType: EVENTS.intelligenceComputed,
      tenantId: msg.tenantId,
      actorId: msg.actorId,
      correlationId: msg.correlationId,
      payload: {
        accountId: p.accountId,
        // String, matching numeric(6,4) exactly.
        opportunityScore,
        riskCount: p.riskSignals.length,
      },
    });
  });

  await cache.invalidate(cache.makeKey(msg.tenantId, "intelligence", p.accountId));
}
