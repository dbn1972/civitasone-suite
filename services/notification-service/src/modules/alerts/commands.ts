import { randomUUID } from "node:crypto";
import type { RequestContext } from "@civitasone/types";
import { queue } from "../../shared/infra.js";
import { COMMANDS } from "../../topics.js";
import type { CreateAlertRuleBody } from "./validators.js";

export type Accepted = { id: string; status: string; correlationId: string };

export async function createAlertRule(ctx: RequestContext, body: CreateAlertRuleBody): Promise<Accepted> {
  const id = randomUUID();
  await queue.publish(COMMANDS.createAlertRule, {
    messageId: id, type: COMMANDS.createAlertRule, tenantId: ctx.tenantId, actorId: ctx.actorId,
    correlationId: ctx.correlationId, schemaVersion: "1.0",
    payload: { id, tenantId: ctx.tenantId, ...body },
  });
  return { id, status: "accepted", correlationId: ctx.correlationId };
}

export async function enableAlertRule(ctx: RequestContext, id: string): Promise<Accepted> {
  const messageId = randomUUID();
  await queue.publish(COMMANDS.enableAlertRule, {
    messageId, type: COMMANDS.enableAlertRule, tenantId: ctx.tenantId, actorId: ctx.actorId,
    correlationId: ctx.correlationId, schemaVersion: "1.0",
    payload: { id, tenantId: ctx.tenantId, enabled: true },
  });
  return { id, status: "accepted", correlationId: ctx.correlationId };
}

export async function disableAlertRule(ctx: RequestContext, id: string): Promise<Accepted> {
  const messageId = randomUUID();
  await queue.publish(COMMANDS.disableAlertRule, {
    messageId, type: COMMANDS.disableAlertRule, tenantId: ctx.tenantId, actorId: ctx.actorId,
    correlationId: ctx.correlationId, schemaVersion: "1.0",
    payload: { id, tenantId: ctx.tenantId, enabled: false },
  });
  return { id, status: "accepted", correlationId: ctx.correlationId };
}
