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

/**
 * Quarantine a batch — marks it unavailable for issue pending quality review.
 * Used when a defect is discovered or shelf life is approaching expiry.
 */
export async function quarantineBatch(ctx: RequestContext, batchId: string, reason: string): Promise<Accepted> {
  await publish(COMMANDS.batchQuarantine, ctx, batchId, {
    id: batchId, tenantId: ctx.tenantId, reason,
  });
  return { id: batchId, status: "accepted", correlationId: ctx.correlationId };
}

/**
 * Recall a batch — traces all issued locations and generates recall notices.
 * The consumer identifies all movement_lines that reference this batch
 * and emits notifications to the receiving stores/employees.
 */
export async function recallBatch(ctx: RequestContext, batchId: string, reason: string, severity: string): Promise<Accepted> {
  const recallId = randomUUID();
  await publish(COMMANDS.batchRecall, ctx, recallId, {
    id: recallId, batchId, tenantId: ctx.tenantId, reason, severity,
  });
  return { id: recallId, status: "accepted", correlationId: ctx.correlationId };
}
