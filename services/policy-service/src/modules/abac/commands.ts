import { randomUUID } from "node:crypto";
import type { RequestContext } from "@civitasone/types";
import { queue } from "../../shared/infra.js";
import { COMMANDS } from "../../topics.js";
import type { CreateRuleBody, UpdateRuleBody } from "./validators.js";

export type Accepted = { id: string; status: string; correlationId: string };

export async function createRule(ctx: RequestContext, body: CreateRuleBody): Promise<Accepted> {
  const id = randomUUID();
  await queue.publish(COMMANDS.createAbacRule, {
    messageId: id, type: COMMANDS.createAbacRule, tenantId: ctx.tenantId, actorId: ctx.actorId,
    correlationId: ctx.correlationId, schemaVersion: "1.0",
    payload: {
      id,
      tenantId: ctx.tenantId,
      roleId: body.roleId,
      expression: JSON.stringify(body.expression),
      enabled: body.enabled,
    },
  });
  return { id, status: "accepted", correlationId: ctx.correlationId };
}

export async function updateRule(ctx: RequestContext, id: string, body: UpdateRuleBody): Promise<Accepted> {
  await queue.publish(COMMANDS.updateAbacRule, {
    messageId: randomUUID(), type: COMMANDS.updateAbacRule, tenantId: ctx.tenantId, actorId: ctx.actorId,
    correlationId: ctx.correlationId, schemaVersion: "1.0",
    payload: {
      id,
      tenantId: ctx.tenantId,
      ...(body.expression !== undefined ? { expression: JSON.stringify(body.expression) } : {}),
      ...(body.enabled !== undefined ? { enabled: body.enabled } : {}),
    },
  });
  return { id, status: "accepted", correlationId: ctx.correlationId };
}

export async function deleteRule(ctx: RequestContext, id: string): Promise<Accepted> {
  await queue.publish(COMMANDS.deleteAbacRule, {
    messageId: randomUUID(), type: COMMANDS.deleteAbacRule, tenantId: ctx.tenantId, actorId: ctx.actorId,
    correlationId: ctx.correlationId, schemaVersion: "1.0",
    payload: { id, tenantId: ctx.tenantId },
  });
  return { id, status: "accepted", correlationId: ctx.correlationId };
}
