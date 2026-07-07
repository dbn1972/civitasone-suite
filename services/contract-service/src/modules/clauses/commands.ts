import { randomUUID } from "node:crypto";
import type { RequestContext } from "@civitasone/types";
import { queue, cache } from "../../shared/infra.js";
import { COMMANDS } from "../../topics.js";
import type { CreateClauseBody, UpdateClauseBody } from "./validators.js";

export type Accepted = { id: string; status: string; correlationId: string };

function invalidateClause(ctx: RequestContext, id: string): Promise<void> {
  return cache.invalidate(cache.makeKey(ctx.tenantId, "clause", id));
}

function invalidateList(ctx: RequestContext): Promise<void> {
  return cache.invalidate(cache.makeKey(ctx.tenantId, "clause", "list"));
}

export async function createClause(ctx: RequestContext, body: CreateClauseBody): Promise<Accepted> {
  const id = randomUUID();
  await queue.publish(COMMANDS.clauseCreate, {
    messageId: id,
    type: COMMANDS.clauseCreate,
    tenantId: ctx.tenantId,
    actorId: ctx.actorId,
    correlationId: ctx.correlationId,
    schemaVersion: "1.0",
    payload: { id, tenantId: ctx.tenantId, ...body },
  });
  await invalidateList(ctx);
  return { id, status: "accepted", correlationId: ctx.correlationId };
}

export async function updateClause(ctx: RequestContext, id: string, body: UpdateClauseBody): Promise<Accepted> {
  await queue.publish(COMMANDS.clauseUpdate, {
    messageId: randomUUID(),
    type: COMMANDS.clauseUpdate,
    tenantId: ctx.tenantId,
    actorId: ctx.actorId,
    correlationId: ctx.correlationId,
    schemaVersion: "1.0",
    payload: { id, tenantId: ctx.tenantId, ...body },
  });
  await invalidateClause(ctx, id);
  await invalidateList(ctx);
  return { id, status: "accepted", correlationId: ctx.correlationId };
}

export async function archiveClause(ctx: RequestContext, id: string, version: number): Promise<Accepted> {
  await queue.publish(COMMANDS.clauseArchive, {
    messageId: randomUUID(),
    type: COMMANDS.clauseArchive,
    tenantId: ctx.tenantId,
    actorId: ctx.actorId,
    correlationId: ctx.correlationId,
    schemaVersion: "1.0",
    payload: { id, tenantId: ctx.tenantId, version },
  });
  await invalidateClause(ctx, id);
  await invalidateList(ctx);
  return { id, status: "accepted", correlationId: ctx.correlationId };
}
