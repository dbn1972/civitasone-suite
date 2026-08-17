/**
 * consumables write commands — publish to queue, return 202 Accepted.
 */
import { randomUUID } from "node:crypto";
import type { RequestContext } from "@civitasone/types";
import { queue } from "../../shared/infra.js";
import { COMMANDS } from "../../topics.js";

export type Accepted = { id: string; status: string; correlationId: string };

export interface CreateConsumableBody {
  name: string;
  category?: string | undefined;
  unit?: string | undefined;
  reorderLevel?: number | undefined;
}

export interface RecordTransactionBody {
  itemId: string;
  txnType: "receipt" | "issue" | "adjustment" | "return";
  qty: number;
  refDoc?: string | undefined;
  notes?: string | undefined;
}

async function publish(type: string, ctx: RequestContext, id: string, payload: Record<string, unknown>): Promise<void> {
  await queue.publish(type, {
    messageId: id, type,
    tenantId: ctx.tenantId, actorId: ctx.actorId, correlationId: ctx.correlationId, schemaVersion: "1.0",
    payload,
  });
}

export async function createConsumable(ctx: RequestContext, body: CreateConsumableBody): Promise<Accepted> {
  const id = randomUUID();
  await publish(COMMANDS.consumableCreate, ctx, id, { id, tenantId: ctx.tenantId, ...body });
  return { id, status: "accepted", correlationId: ctx.correlationId };
}

export async function recordTransaction(ctx: RequestContext, body: RecordTransactionBody): Promise<Accepted> {
  const id = randomUUID();
  await publish(COMMANDS.consumableTransaction, ctx, id, { id, tenantId: ctx.tenantId, ...body });
  return { id, status: "accepted", correlationId: ctx.correlationId };
}
