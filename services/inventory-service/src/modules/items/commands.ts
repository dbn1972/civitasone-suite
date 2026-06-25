/**
 * Command handlers (WRITE PATH) — validate, publish command, return accepted.
 * The consumer is the only code that writes Postgres.
 */
import { randomUUID } from "node:crypto";
import type { RequestContext } from "@civitasone/types";
import { queue } from "../../shared/infra.js";
import { COMMANDS } from "../../topics.js";
import type { CreateItemBody, UpdateItemBody, CreateCategoryBody, CreateUomBody } from "./validators.js";

export type Accepted = { id: string; status: string; correlationId: string };

async function publish(type: string, ctx: RequestContext, id: string, payload: Record<string, unknown>): Promise<void> {
  await queue.publish(type, {
    messageId: id,
    type,
    tenantId: ctx.tenantId,
    actorId: ctx.actorId,
    correlationId: ctx.correlationId,
    schemaVersion: "1.0",
    payload,
  });
}

export async function createItem(ctx: RequestContext, body: CreateItemBody): Promise<Accepted> {
  const id = randomUUID();
  await publish(COMMANDS.itemCreate, ctx, id, { id, tenantId: ctx.tenantId, ...body });
  return { id, status: "accepted", correlationId: ctx.correlationId };
}

export async function updateItem(ctx: RequestContext, id: string, body: UpdateItemBody): Promise<Accepted> {
  await publish(COMMANDS.itemUpdate, ctx, id, { id, tenantId: ctx.tenantId, ...body });
  return { id, status: "accepted", correlationId: ctx.correlationId };
}

export async function createCategory(ctx: RequestContext, body: CreateCategoryBody): Promise<Accepted> {
  const id = randomUUID();
  await publish(COMMANDS.categoryCreate, ctx, id, { id, tenantId: ctx.tenantId, ...body });
  return { id, status: "accepted", correlationId: ctx.correlationId };
}

export async function createUom(ctx: RequestContext, body: CreateUomBody): Promise<Accepted> {
  const id = randomUUID();
  await publish(COMMANDS.uomCreate, ctx, id, { id, tenantId: ctx.tenantId, ...body });
  return { id, status: "accepted", correlationId: ctx.correlationId };
}
