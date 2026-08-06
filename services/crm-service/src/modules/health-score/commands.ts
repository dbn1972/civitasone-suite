import { queue } from "../../shared/infra.js";
import { COMMANDS } from "../../topics.js";
import type { RequestContext } from "@civitasone/types";
import { randomUUID } from "node:crypto";

interface CreateConfigPayload {
  id: string;
  signalName: string;
  weight: number;
  decayDays: number;
  source: string;
  enabled: boolean;
}

interface UpdateConfigPayload {
  id: string;
  weight?: number | undefined;
  decayDays?: number | undefined;
  enabled?: boolean | undefined;
}

interface RecomputePayload {
  accountId: string;
}

export async function publishCreateConfig(ctx: RequestContext, payload: CreateConfigPayload): Promise<void> {
  await queue.publish({
    topic: COMMANDS.createHealthScoreConfig,
    messageId: randomUUID(),
    tenantId: ctx.tenantId,
    actorId: ctx.actorId,
    correlationId: ctx.correlationId,
    payload,
  });
}

export async function publishUpdateConfig(ctx: RequestContext, payload: UpdateConfigPayload): Promise<void> {
  await queue.publish({
    topic: COMMANDS.updateHealthScoreConfig,
    messageId: randomUUID(),
    tenantId: ctx.tenantId,
    actorId: ctx.actorId,
    correlationId: ctx.correlationId,
    payload,
  });
}

export async function publishRecomputeHealthScore(ctx: RequestContext, payload: RecomputePayload): Promise<void> {
  await queue.publish({
    topic: COMMANDS.recomputeHealthScore,
    messageId: randomUUID(),
    tenantId: ctx.tenantId,
    actorId: ctx.actorId,
    correlationId: ctx.correlationId,
    payload,
  });
}
