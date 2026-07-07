import { randomUUID } from "node:crypto";
import type { RequestContext } from "@civitasone/types";
import { queue, cache } from "../../shared/infra.js";
import { COMMANDS } from "../../topics.js";
import type { CreateTemplateBody, UpdateTemplateBody, AddClauseBody, UpdateClauseBody } from "./validators.js";

export type Accepted = { id: string; status: string; correlationId: string };

function invalidateTemplate(ctx: RequestContext, id: string): Promise<void> {
  return cache.invalidate(cache.makeKey(ctx.tenantId, "template", id));
}

function invalidateList(ctx: RequestContext): Promise<void> {
  return cache.invalidate(cache.makeKey(ctx.tenantId, "template", "list"));
}

export async function createTemplate(ctx: RequestContext, body: CreateTemplateBody): Promise<Accepted> {
  const id = randomUUID();
  await queue.publish(COMMANDS.templateCreate, {
    messageId: id,
    type: COMMANDS.templateCreate,
    tenantId: ctx.tenantId,
    actorId: ctx.actorId,
    correlationId: ctx.correlationId,
    schemaVersion: "1.0",
    payload: { id, tenantId: ctx.tenantId, ...body },
  });
  await invalidateList(ctx);
  return { id, status: "accepted", correlationId: ctx.correlationId };
}

export async function updateTemplate(ctx: RequestContext, id: string, body: UpdateTemplateBody): Promise<Accepted> {
  await queue.publish(COMMANDS.templateUpdate, {
    messageId: randomUUID(),
    type: COMMANDS.templateUpdate,
    tenantId: ctx.tenantId,
    actorId: ctx.actorId,
    correlationId: ctx.correlationId,
    schemaVersion: "1.0",
    payload: { id, tenantId: ctx.tenantId, ...body },
  });
  await invalidateTemplate(ctx, id);
  await invalidateList(ctx);
  return { id, status: "accepted", correlationId: ctx.correlationId };
}

export async function deleteTemplate(ctx: RequestContext, id: string, version: number): Promise<Accepted> {
  await queue.publish(COMMANDS.templateDelete, {
    messageId: randomUUID(),
    type: COMMANDS.templateDelete,
    tenantId: ctx.tenantId,
    actorId: ctx.actorId,
    correlationId: ctx.correlationId,
    schemaVersion: "1.0",
    payload: { id, tenantId: ctx.tenantId, version },
  });
  await invalidateTemplate(ctx, id);
  await invalidateList(ctx);
  return { id, status: "accepted", correlationId: ctx.correlationId };
}

export async function addClauseToTemplate(
  ctx: RequestContext,
  templateId: string,
  body: AddClauseBody,
): Promise<Accepted> {
  const id = randomUUID();
  await queue.publish(COMMANDS.templateClauseAdd, {
    messageId: id,
    type: COMMANDS.templateClauseAdd,
    tenantId: ctx.tenantId,
    actorId: ctx.actorId,
    correlationId: ctx.correlationId,
    schemaVersion: "1.0",
    payload: { id, templateId, tenantId: ctx.tenantId, ...body },
  });
  await invalidateTemplate(ctx, templateId);
  return { id, status: "accepted", correlationId: ctx.correlationId };
}

export async function updateTemplateClause(
  ctx: RequestContext,
  templateId: string,
  clauseId: string,
  body: UpdateClauseBody,
): Promise<Accepted> {
  await queue.publish(COMMANDS.templateClauseUpdate, {
    messageId: randomUUID(),
    type: COMMANDS.templateClauseUpdate,
    tenantId: ctx.tenantId,
    actorId: ctx.actorId,
    correlationId: ctx.correlationId,
    schemaVersion: "1.0",
    payload: { id: clauseId, templateId, tenantId: ctx.tenantId, ...body },
  });
  await invalidateTemplate(ctx, templateId);
  return { id: clauseId, status: "accepted", correlationId: ctx.correlationId };
}

export async function removeTemplateClause(
  ctx: RequestContext,
  templateId: string,
  clauseId: string,
): Promise<Accepted> {
  await queue.publish(COMMANDS.templateClauseRemove, {
    messageId: randomUUID(),
    type: COMMANDS.templateClauseRemove,
    tenantId: ctx.tenantId,
    actorId: ctx.actorId,
    correlationId: ctx.correlationId,
    schemaVersion: "1.0",
    payload: { id: clauseId, templateId, tenantId: ctx.tenantId },
  });
  await invalidateTemplate(ctx, templateId);
  return { id: clauseId, status: "accepted", correlationId: ctx.correlationId };
}
