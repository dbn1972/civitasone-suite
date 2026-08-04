/**
 * Merge command publishers for leads and accounts (DQ-002).
 * Route -> publish command -> 202; the merge-consumer persists asynchronously.
 */
import type { RequestContext } from "@civitasone/types";
import { queue, cache } from "../../shared/infra.js";
import { commandId } from "../../shared/idempotency.js";
import { COMMANDS, RESOURCE } from "../../topics.js";
import type { Accepted } from "./commands.js";

export interface MergeBody {
  primaryId: string;
  duplicateId: string;
}

export async function mergeLeads(ctx: RequestContext, body: MergeBody): Promise<Accepted> {
  const msgId = commandId(ctx, `${COMMANDS.mergeLeads}:${body.primaryId}`);
  await queue.publish(COMMANDS.mergeLeads, {
    messageId: msgId, type: COMMANDS.mergeLeads,
    tenantId: ctx.tenantId, actorId: ctx.actorId, correlationId: ctx.correlationId, schemaVersion: "1.0",
    payload: { ...body, tenantId: ctx.tenantId },
  });
  await cache.invalidateResource(ctx.tenantId, RESOURCE);
  return { id: body.primaryId, status: "accepted", correlationId: ctx.correlationId };
}

export async function mergeAccounts(ctx: RequestContext, body: MergeBody): Promise<Accepted> {
  const msgId = commandId(ctx, `${COMMANDS.mergeAccounts}:${body.primaryId}`);
  await queue.publish(COMMANDS.mergeAccounts, {
    messageId: msgId, type: COMMANDS.mergeAccounts,
    tenantId: ctx.tenantId, actorId: ctx.actorId, correlationId: ctx.correlationId, schemaVersion: "1.0",
    payload: { ...body, tenantId: ctx.tenantId },
  });
  await cache.invalidateResource(ctx.tenantId, RESOURCE);
  return { id: body.primaryId, status: "accepted", correlationId: ctx.correlationId };
}
