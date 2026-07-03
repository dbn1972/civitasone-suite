import { randomUUID } from "node:crypto";
import type { RequestContext } from "@civitasone/types";
import { queue, cache } from "../../shared/infra.js";
import { COMMANDS } from "../../topics.js";
import type { CategoryView } from "./schema.js";
import type {
  CreateCategoryBody,
  UpdateCategoryBody,
  ReorderCategoryBody,
} from "./validators.js";

export type Accepted = { id: string; status: string; correlationId: string };

const RESOURCE = "category";

export async function createCategory(ctx: RequestContext, body: CreateCategoryBody): Promise<Accepted> {
  const id = randomUUID();
  const projected: CategoryView = {
    id,
    tenantId: ctx.tenantId,
    parentId: body.parentId ?? null,
    name: body.name,
    slug: body.slug,
    description: body.description ?? "",
    icon: body.icon ?? null,
    sortOrder: body.sortOrder ?? 0,
    createdAt: new Date(),
    updatedAt: new Date(),
    createdBy: ctx.actorId,
    updatedBy: ctx.actorId,
    version: 1,
  };

  await cache.put(cache.makeKey(ctx.tenantId, RESOURCE, id), projected);
  await queue.publish(COMMANDS.categoryCreate, {
    messageId: id,
    type: COMMANDS.categoryCreate,
    tenantId: ctx.tenantId,
    actorId: ctx.actorId,
    correlationId: ctx.correlationId,
    schemaVersion: "1.0",
    payload: projected,
  });

  return { id, status: "accepted", correlationId: ctx.correlationId };
}

export async function updateCategory(ctx: RequestContext, id: string, body: UpdateCategoryBody): Promise<Accepted> {
  const messageId = randomUUID();
  await queue.publish(COMMANDS.categoryUpdate, {
    messageId,
    type: COMMANDS.categoryUpdate,
    tenantId: ctx.tenantId,
    actorId: ctx.actorId,
    correlationId: ctx.correlationId,
    schemaVersion: "1.0",
    payload: { id, ...body },
  });

  return { id, status: "accepted", correlationId: ctx.correlationId };
}

export async function deleteCategory(ctx: RequestContext, id: string): Promise<Accepted> {
  const messageId = randomUUID();
  await queue.publish(COMMANDS.categoryDelete, {
    messageId,
    type: COMMANDS.categoryDelete,
    tenantId: ctx.tenantId,
    actorId: ctx.actorId,
    correlationId: ctx.correlationId,
    schemaVersion: "1.0",
    payload: { id },
  });

  return { id, status: "accepted", correlationId: ctx.correlationId };
}

export async function reorderCategory(ctx: RequestContext, body: ReorderCategoryBody): Promise<Accepted> {
  const messageId = randomUUID();
  await queue.publish(COMMANDS.categoryReorder, {
    messageId,
    type: COMMANDS.categoryReorder,
    tenantId: ctx.tenantId,
    actorId: ctx.actorId,
    correlationId: ctx.correlationId,
    schemaVersion: "1.0",
    payload: body,
  });

  return { id: messageId, status: "accepted", correlationId: ctx.correlationId };
}
