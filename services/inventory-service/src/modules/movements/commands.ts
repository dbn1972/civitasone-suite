/**
 * Stock-movement command handlers (WRITE PATH). Each publishes a typed command;
 * the consumer applies it transactionally with the outbox.
 */
import { randomUUID } from "node:crypto";
import type { RequestContext } from "@civitasone/types";
import { queue } from "../../shared/infra.js";
import { COMMANDS } from "../../topics.js";
import type { CreateReceiptBody, CreateIssueBody, CreateTransferBody, CreateAdjustmentBody } from "./validators.js";

export type Accepted = { id: string; status: string; correlationId: string };

async function publish(type: string, ctx: RequestContext, id: string, payload: Record<string, unknown>): Promise<void> {
  await queue.publish(type, {
    messageId: id, type,
    tenantId: ctx.tenantId, actorId: ctx.actorId, correlationId: ctx.correlationId, schemaVersion: "1.0",
    payload,
  });
}

export async function createReceipt(ctx: RequestContext, body: CreateReceiptBody): Promise<Accepted> {
  const id = randomUUID();
  await publish(COMMANDS.receiptCreate, ctx, id, { id, tenantId: ctx.tenantId, ...body });
  return { id, status: "accepted", correlationId: ctx.correlationId };
}

export async function createIssue(ctx: RequestContext, body: CreateIssueBody): Promise<Accepted> {
  const id = randomUUID();
  await publish(COMMANDS.issueCreate, ctx, id, { id, tenantId: ctx.tenantId, ...body });
  return { id, status: "accepted", correlationId: ctx.correlationId };
}

export async function createTransfer(ctx: RequestContext, body: CreateTransferBody): Promise<Accepted> {
  const id = randomUUID();
  await publish(COMMANDS.transferCreate, ctx, id, { id, tenantId: ctx.tenantId, ...body });
  return { id, status: "accepted", correlationId: ctx.correlationId };
}

export async function createAdjustment(ctx: RequestContext, body: CreateAdjustmentBody): Promise<Accepted> {
  const id = randomUUID();
  await publish(COMMANDS.adjustmentCreate, ctx, id, { id, tenantId: ctx.tenantId, ...body });
  return { id, status: "accepted", correlationId: ctx.correlationId };
}
