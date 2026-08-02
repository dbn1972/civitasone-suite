import { randomUUID } from "node:crypto";
import type { RequestContext } from "@civitasone/types";
import { queue } from "../../shared/infra.js";
import { COMMANDS } from "../../topics.js";

export type Accepted = { id: string; status: string; correlationId: string };

export async function createRule(
  ctx: RequestContext,
  body: {
    name: string;
    ordinal: number;
    enabled?: boolean;
    trigger: unknown;
    actions: unknown[];
  },
): Promise<Accepted> {
  const id = randomUUID();
  await queue.publish(COMMANDS.automationRuleCreate, {
    messageId: id,
    type: COMMANDS.automationRuleCreate,
    tenantId: ctx.tenantId,
    actorId: ctx.actorId,
    correlationId: ctx.correlationId,
    schemaVersion: "1.0",
    payload: { id, tenantId: ctx.tenantId, ...body, enabled: body.enabled ?? true },
  });
  return { id, status: "accepted", correlationId: ctx.correlationId };
}

export async function updateRule(
  ctx: RequestContext,
  id: string,
  body: Record<string, unknown>,
): Promise<Accepted> {
  await queue.publish(COMMANDS.automationRuleUpdate, {
    messageId: randomUUID(),
    type: COMMANDS.automationRuleUpdate,
    tenantId: ctx.tenantId,
    actorId: ctx.actorId,
    correlationId: ctx.correlationId,
    schemaVersion: "1.0",
    payload: { id, tenantId: ctx.tenantId, ...body },
  });
  return { id, status: "accepted", correlationId: ctx.correlationId };
}

export async function deleteRule(ctx: RequestContext, id: string): Promise<Accepted> {
  await queue.publish(COMMANDS.automationRuleDelete, {
    messageId: randomUUID(),
    type: COMMANDS.automationRuleDelete,
    tenantId: ctx.tenantId,
    actorId: ctx.actorId,
    correlationId: ctx.correlationId,
    schemaVersion: "1.0",
    payload: { id, tenantId: ctx.tenantId },
  });
  return { id, status: "accepted", correlationId: ctx.correlationId };
}
