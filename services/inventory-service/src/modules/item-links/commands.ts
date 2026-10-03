/**
 * Command handlers (WRITE PATH) -- publish a command and return accepted. The consumer is the
 * only code that writes Postgres.
 */
import { randomUUID } from "node:crypto";
import type { RequestContext } from "@civitasone/types";
import { queue } from "../../shared/infra.js";
import { COMMANDS } from "../../topics.js";
import type { CreateItemLinkBody } from "./validators.js";

export type Accepted = { id: string; status: string; correlationId: string };

async function publish(type: string, ctx: RequestContext, messageId: string, payload: Record<string, unknown>): Promise<void> {
  await queue.publish(type, {
    messageId,
    type,
    tenantId: ctx.tenantId,
    actorId: ctx.actorId,
    correlationId: ctx.correlationId,
    schemaVersion: "1.0",
    payload,
  });
}

export async function createItemLink(
  ctx: RequestContext, body: CreateItemLinkBody, stock: { code: string; name: string },
): Promise<Accepted> {
  const id = randomUUID();
  await publish(COMMANDS.itemLinkCreate, ctx, id, {
    id, tenantId: ctx.tenantId, ...body, stockItemCode: stock.code.slice(0, 64), stockItemName: stock.name.slice(0, 256),
  });
  return { id, status: "accepted", correlationId: ctx.correlationId };
}

export async function removeItemLink(ctx: RequestContext, id: string): Promise<Accepted> {
  // The link id lives in the payload; the envelope gets a fresh messageId so a repeated
  // link -> unlink -> link -> unlink of the same pair is never deduped by the inbox.
  await publish(COMMANDS.itemLinkRemove, ctx, randomUUID(), { id, tenantId: ctx.tenantId });
  return { id, status: "accepted", correlationId: ctx.correlationId };
}
