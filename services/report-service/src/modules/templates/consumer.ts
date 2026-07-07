/**
 * templates consumer — processes template commands from queue.
 * CQRS: markProcessed → DB write → outbox event → cache invalidate.
 */
import type { RequestContext } from "@civitasone/types";
import { db } from "../../shared/db.js";
import { cache } from "../../shared/infra.js";
import { markProcessed, enqueue } from "../../shared/outbox.js";
import { EVENTS } from "../../topics.js";
import * as repo from "./repo.js";
import type { TemplateInsert } from "./schema.js";

const RESOURCE = "template";

export async function handleCreateTemplate(
  messageId: string,
  ctx: Pick<RequestContext, "tenantId" | "actorId" | "correlationId">,
  payload: TemplateInsert,
): Promise<void> {
  await db.transaction(async (tx) => {
    await markProcessed(tx, messageId);
    await repo.insert(tx as unknown as repo.Writer, payload);
    await enqueue(tx, {
      topic: EVENTS.templateCreated,
      eventType: EVENTS.templateCreated,
      tenantId: ctx.tenantId,
      actorId: ctx.actorId,
      correlationId: ctx.correlationId,
      payload: { id: payload.id, name: payload.name },
    });
  });
  await cache.invalidate(cache.makeKey(ctx.tenantId, RESOURCE, payload.id as string));
}

export async function handleUpdateTemplate(
  messageId: string,
  ctx: Pick<RequestContext, "tenantId" | "actorId" | "correlationId">,
  payload: { id: string; version: number; [key: string]: unknown },
): Promise<void> {
  const { id, version, ...updates } = payload;
  await db.transaction(async (tx) => {
    await markProcessed(tx, messageId);
    const success = await repo.update(
      tx as unknown as repo.Writer,
      id,
      ctx.tenantId,
      version,
      { ...updates, updatedBy: ctx.actorId } as Parameters<typeof repo.update>[4],
    );
    if (!success) {
      // Version conflict — command is effectively a no-op; do not emit event
      return;
    }
    await enqueue(tx, {
      topic: EVENTS.templateUpdated,
      eventType: EVENTS.templateUpdated,
      tenantId: ctx.tenantId,
      actorId: ctx.actorId,
      correlationId: ctx.correlationId,
      payload: { id },
    });
  });
  await cache.invalidate(cache.makeKey(ctx.tenantId, RESOURCE, id));
}

export async function handleDeleteTemplate(
  messageId: string,
  ctx: Pick<RequestContext, "tenantId" | "actorId" | "correlationId">,
  payload: { id: string },
): Promise<void> {
  await db.transaction(async (tx) => {
    await markProcessed(tx, messageId);
    await repo.softDelete(tx as unknown as repo.Writer, payload.id, ctx.tenantId, ctx.actorId);
    await enqueue(tx, {
      topic: EVENTS.templateDeleted,
      eventType: EVENTS.templateDeleted,
      tenantId: ctx.tenantId,
      actorId: ctx.actorId,
      correlationId: ctx.correlationId,
      payload: { id: payload.id },
    });
  });
  await cache.invalidate(cache.makeKey(ctx.tenantId, RESOURCE, payload.id));
}
