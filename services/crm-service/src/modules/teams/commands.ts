import type { RequestContext } from "@civitasone/types";
import { queue } from "../../shared/infra.js";
import { commandId } from "../../shared/idempotency.js";
import { COMMANDS } from "../../topics.js";

export type Accepted = { id: string; status: string; correlationId: string };

async function pub(ctx: RequestContext, type: string, id: string, payload: Record<string, unknown>): Promise<Accepted> {
  await queue.publish(type, {
    messageId: commandId(ctx, `${type}:${id}`), type, tenantId: ctx.tenantId, actorId: ctx.actorId,
    correlationId: ctx.correlationId, schemaVersion: "1.0",
    payload: { ...payload, id, tenantId: ctx.tenantId },
  });
  return { id, status: "accepted", correlationId: ctx.correlationId };
}

export const createTeam = (
  ctx: RequestContext,
  id: string,
  body: { name: string; territory: Record<string, unknown> },
) => pub(ctx, COMMANDS.createTeam, id, body);

export const updateAgentCapacity = (
  ctx: RequestContext,
  agentId: string,
  body: { maxLeads?: number | undefined; available?: boolean | undefined; onLeave?: boolean | undefined },
) => pub(ctx, COMMANDS.updateAgentCapacity, agentId, { agentId, ...body });
