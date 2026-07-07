/**
 * Command handlers (WRITE PATH) — validate, publish command, return accepted.
 * The consumer is the only code that writes Postgres.
 */
import { randomUUID } from "node:crypto";
import type { RequestContext } from "@civitasone/types";
import { queue } from "../../shared/infra.js";
import { COMMANDS } from "../../topics.js";
import type { CreateCycleCountBody } from "./validators.js";

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

export async function createCycleCount(ctx: RequestContext, body: CreateCycleCountBody): Promise<Accepted> {
  const id = randomUUID();
  await publish(COMMANDS.cycleCountCreate, ctx, id, { id, tenantId: ctx.tenantId, ...body });
  return { id, status: "accepted", correlationId: ctx.correlationId };
}

export async function approveCycleCount(ctx: RequestContext, id: string, version: number): Promise<Accepted> {
  await publish(COMMANDS.cycleCountApprove, ctx, id, { id, tenantId: ctx.tenantId, version });
  return { id, status: "accepted", correlationId: ctx.correlationId };
}

export async function rejectCycleCount(ctx: RequestContext, id: string, version: number, reason: string): Promise<Accepted> {
  await publish(COMMANDS.cycleCountReject, ctx, id, { id, tenantId: ctx.tenantId, version, reason });
  return { id, status: "accepted", correlationId: ctx.correlationId };
}
