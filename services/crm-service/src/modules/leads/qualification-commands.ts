/** LQ-001 command publisher for a lead qualification submission (async CQRS). */
import { randomUUID } from "node:crypto";
import type { RequestContext } from "@civitasone/types";
import { queue } from "../../shared/infra.js";
import { commandId } from "../../shared/idempotency.js";
import { COMMANDS } from "../../topics.js";

export type Accepted = { id: string; status: string; correlationId: string; outcome: string; score: number };

export interface QualifyPublish {
  leadId: string;
  frameworkId: string;
  answers: Record<string, unknown>;
  outcome: string;
  score: number;
  factors: Record<string, number>;
}

/**
 * Publish a computed qualification result for persistence. The outcome + score are
 * computed by the pure domain in the route (deterministic), then persisted by the
 * consumer; the qualification id is allocated here so the caller can track it.
 */
export async function qualifyLead(ctx: RequestContext, p: QualifyPublish): Promise<Accepted> {
  const qualificationId = randomUUID();
  const messageId = commandId(ctx, `${COMMANDS.qualifyLead}:${p.leadId}:${qualificationId}`);
  await queue.publish(COMMANDS.qualifyLead, {
    messageId,
    type: COMMANDS.qualifyLead,
    tenantId: ctx.tenantId,
    actorId: ctx.actorId,
    correlationId: ctx.correlationId,
    schemaVersion: "1.0",
    payload: {
      qualificationId,
      tenantId: ctx.tenantId,
      leadId: p.leadId,
      frameworkId: p.frameworkId,
      answers: p.answers,
      outcome: p.outcome,
      score: p.score,
      factors: p.factors,
    },
  });
  return {
    id: qualificationId,
    status: "accepted",
    correlationId: ctx.correlationId,
    outcome: p.outcome,
    score: p.score,
  };
}
