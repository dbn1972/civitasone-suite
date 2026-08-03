import { randomUUID } from "node:crypto";
import type { RequestContext } from "@civitasone/types";
import { queue } from "../../shared/infra.js";
import { COMMANDS } from "../../topics.js";

export type Accepted = { id: string; status: string; correlationId: string };

function publish(ctx: RequestContext, type: string, messageId: string, payload: Record<string, unknown>): Promise<string> {
  return queue.publish(type, {
    messageId,
    type,
    tenantId: ctx.tenantId,
    actorId: ctx.actorId,
    correlationId: ctx.correlationId,
    schemaVersion: "1.0",
    payload: { tenantId: ctx.tenantId, ...payload },
  });
}

export async function createRule(
  ctx: RequestContext,
  body: {
    name: string;
    strategy: string;
    criteria?: Record<string, unknown> | null;
    weight: number;
    enabled: boolean;
    ordinal: number;
  },
): Promise<Accepted> {
  const id = randomUUID();
  await publish(ctx, COMMANDS.routingRuleCreate, id, { id, ...body, criteria: body.criteria ?? null });
  return { id, status: "accepted", correlationId: ctx.correlationId };
}

export async function updateRule(
  ctx: RequestContext,
  id: string,
  body: {
    version: number;
    name?: string;
    strategy?: string;
    criteria?: Record<string, unknown> | null;
    weight?: number;
    enabled?: boolean;
    ordinal?: number;
  },
): Promise<Accepted> {
  await publish(ctx, COMMANDS.routingRuleUpdate, randomUUID(), { id, ...body });
  return { id, status: "accepted", correlationId: ctx.correlationId };
}

export async function deleteRule(ctx: RequestContext, id: string): Promise<Accepted> {
  await publish(ctx, COMMANDS.routingRuleDelete, randomUUID(), { id });
  return { id, status: "accepted", correlationId: ctx.correlationId };
}

export async function upsertCapacity(
  ctx: RequestContext,
  agentId: string,
  body: { maxTickets?: number; skills?: string[]; available?: boolean },
): Promise<Accepted> {
  const id = randomUUID();
  await publish(ctx, COMMANDS.routingCapacityUpsert, id, { agentId, ...body });
  return { id, status: "accepted", correlationId: ctx.correlationId };
}

export async function enqueueTicket(
  ctx: RequestContext,
  body: { ticketId: string; queueName: string; priority: number },
): Promise<Accepted> {
  const id = randomUUID();
  await publish(ctx, COMMANDS.routingQueueEnqueue, id, { id, ...body });
  return { id, status: "accepted", correlationId: ctx.correlationId };
}

export async function dequeueTicket(
  ctx: RequestContext,
  body: { queueName: string },
): Promise<Accepted> {
  const id = randomUUID();
  await publish(ctx, COMMANDS.routingQueueDequeue, id, body);
  return { id, status: "accepted", correlationId: ctx.correlationId };
}
