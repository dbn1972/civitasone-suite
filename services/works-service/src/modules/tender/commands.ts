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

export async function createPreTenderCommand(ctx: RequestContext, body: Record<string, unknown>): Promise<Accepted> {
  return publish(ctx, COMMANDS.preTenderCreate, body);
}

export async function addQuotationCommand(ctx: RequestContext, body: Record<string, unknown>): Promise<Accepted> {
  return publish(ctx, COMMANDS.quotationAdd, body);
}

export async function createAwardCommand(ctx: RequestContext, body: Record<string, unknown>): Promise<Accepted> {
  return publish(ctx, COMMANDS.awardCreate, body);
}

export async function daoFinalizeAwardCommand(ctx: RequestContext, id: string): Promise<Accepted> {
  return publish(ctx, COMMANDS.awardDaoFinalize, { id });
}

export async function doFinalizeAwardCommand(ctx: RequestContext, id: string): Promise<Accepted> {
  return publish(ctx, COMMANDS.awardDoFinalize, { id });
}
