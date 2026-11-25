import { randomUUID } from "node:crypto";
import type { RequestContext } from "@civitasone/types";
import { queue, cache } from "../../shared/infra.js";
import { COMMANDS } from "../../topics.js";
import type { AssignBody, CloseBody } from "./validators.js";

export type Accepted = { id: string; status: string; correlationId: string };

async function pub(ctx: RequestContext, topic: string, id: string, payload: Record<string, unknown>): Promise<Accepted> {
  await queue.publish(topic, {
    messageId: randomUUID(), type: topic,
    tenantId: ctx.tenantId, actorId: ctx.actorId, correlationId: ctx.correlationId, schemaVersion: "1.0",
    payload: { investigationId: id, tenantId: ctx.tenantId, ...payload },
  });
  await cache.invalidate(cache.makeKey(ctx.tenantId, "investigation", "list:50:0"));
  return { id, status: "accepted", correlationId: ctx.correlationId };
}

export const assignInvestigation = (ctx: RequestContext, id: string, body: AssignBody) =>
  pub(ctx, COMMANDS.investigationAssign, id, { assignedTo: body.assignedTo });

export const closeInvestigation = (ctx: RequestContext, id: string, body: CloseBody) =>
  pub(ctx, COMMANDS.investigationClose, id, { outcome: body.outcome, reason: body.reason });
