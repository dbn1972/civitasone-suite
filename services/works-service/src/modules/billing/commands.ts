import { randomUUID } from "node:crypto";
import type { RequestContext } from "@civitasone/types";
import { queue } from "../../shared/infra.js";
import { COMMANDS } from "../../topics.js";

export type Accepted = { id: string; status: "accepted"; correlationId: string };

async function publish(
  ctx: RequestContext,
  type: string,
  payload: Record<string, unknown>,
): Promise<Accepted> {
  const id = (payload.id as string) ?? randomUUID();
  await queue.publish(type, {
    messageId: randomUUID(),
    type,
    tenantId: ctx.tenantId,
    actorId: ctx.actorId,
    correlationId: ctx.correlationId,
    schemaVersion: "1.0",
    payload: { ...payload, id },
  });
  return { id, status: "accepted", correlationId: ctx.correlationId };
}

export async function issueMbCommand(ctx: RequestContext, body: Record<string, unknown>): Promise<Accepted> {
  return publish(ctx, COMMANDS.mbIssue, body);
}

export async function finalizeMbCommand(
  ctx: RequestContext,
  id: string,
  nextStatus: string,
): Promise<Accepted> {
  return publish(ctx, COMMANDS.mbFinalize, { id, nextStatus });
}

export async function createBillCommand(ctx: RequestContext, body: Record<string, unknown>): Promise<Accepted> {
  return publish(ctx, COMMANDS.billCreate, body);
}

export async function finalizeBillCommand(
  ctx: RequestContext,
  id: string,
  nextStatus: string,
): Promise<Accepted> {
  return publish(ctx, COMMANDS.billFinalize, { id, nextStatus });
}

export async function recordMeasurementCommand(
  ctx: RequestContext,
  body: Record<string, unknown>,
): Promise<Accepted> {
  return publish(ctx, COMMANDS.measurementRecord, body);
}

export async function compileAccountCommand(
  ctx: RequestContext,
  body: Record<string, unknown>,
): Promise<Accepted> {
  return publish(ctx, COMMANDS.accountCompile, body);
}
