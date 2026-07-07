/**
 * Command handlers (WRITE PATH) — validate, publish command, return accepted.
 * The consumer is the only code that writes Postgres.
 */
import { randomUUID } from "node:crypto";
import type { RequestContext } from "@civitasone/types";
import { queue } from "../../shared/infra.js";
import { COMMANDS } from "../../topics.js";
import type { CreateBatchBody, CreateSerialBody, IssueFromBatchBody } from "./validators.js";

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

export async function createBatch(ctx: RequestContext, body: CreateBatchBody): Promise<Accepted> {
  const id = randomUUID();
  await publish(COMMANDS.batchCreate, ctx, id, { id, tenantId: ctx.tenantId, ...body });
  return { id, status: "accepted", correlationId: ctx.correlationId };
}

export async function registerSerial(ctx: RequestContext, body: CreateSerialBody): Promise<Accepted> {
  const id = randomUUID();
  await publish(COMMANDS.serialRegister, ctx, id, { id, tenantId: ctx.tenantId, ...body });
  return { id, status: "accepted", correlationId: ctx.correlationId };
}

export async function issueFromBatch(ctx: RequestContext, body: IssueFromBatchBody): Promise<Accepted> {
  const id = randomUUID();
  await publish(COMMANDS.batchIssue, ctx, id, { id, tenantId: ctx.tenantId, ...body });
  return { id, status: "accepted", correlationId: ctx.correlationId };
}
