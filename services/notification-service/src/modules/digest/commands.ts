import { randomUUID } from "node:crypto";
import type { RequestContext } from "@civitasone/types";
import { queue } from "../../shared/infra.js";
import { COMMANDS } from "../../topics.js";

export type Accepted = { id: string; status: string; correlationId: string };

export interface CreateDigestRulePayload {
  eventType: string;
  channel: string;
  accumulationWindowMinutes: number;
  maxBatchSize?: number;
  digestTemplateId: string;
}

export interface UpdateDigestRulePayload {
  accumulationWindowMinutes?: number;
  maxBatchSize?: number;
  digestTemplateId?: string;
  enabled?: boolean;
}

export async function createDigestRule(ctx: RequestContext, payload: CreateDigestRulePayload): Promise<Accepted> {
  const id = randomUUID();
  await queue.publish(COMMANDS.createDigestRule, {
    messageId: id, type: COMMANDS.createDigestRule, tenantId: ctx.tenantId, actorId: ctx.actorId,
    correlationId: ctx.correlationId, schemaVersion: "1.0",
    payload: { id, tenantId: ctx.tenantId, ...payload },
  });
  return { id, status: "accepted", correlationId: ctx.correlationId };
}

export async function updateDigestRule(ctx: RequestContext, id: string, payload: UpdateDigestRulePayload): Promise<Accepted> {
  const messageId = randomUUID();
  await queue.publish(COMMANDS.updateDigestRule, {
    messageId, type: COMMANDS.updateDigestRule, tenantId: ctx.tenantId, actorId: ctx.actorId,
    correlationId: ctx.correlationId, schemaVersion: "1.0",
    payload: { id, tenantId: ctx.tenantId, ...payload },
  });
  return { id, status: "accepted", correlationId: ctx.correlationId };
}

export async function flushDigest(ctx: RequestContext, bucketId: string): Promise<Accepted> {
  const messageId = randomUUID();
  await queue.publish(COMMANDS.flushDigest, {
    messageId, type: COMMANDS.flushDigest, tenantId: ctx.tenantId, actorId: ctx.actorId,
    correlationId: ctx.correlationId, schemaVersion: "1.0",
    payload: { bucketId, tenantId: ctx.tenantId },
  });
  return { id: bucketId, status: "accepted", correlationId: ctx.correlationId };
}
