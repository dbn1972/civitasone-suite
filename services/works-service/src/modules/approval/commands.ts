import { randomUUID } from "node:crypto";
import type { RequestContext } from "@civitasone/types";
import { queue } from "../../shared/infra.js";
import { COMMANDS } from "../../topics.js";

export type Accepted = { id: string; status: "accepted"; correlationId: string };
export type AcceptedWithType = Accepted & { approvalType?: string; sanctionType?: string };

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

export async function createAaCommand(
  ctx: RequestContext,
  body: Record<string, unknown>,
  approvalType: string,
): Promise<AcceptedWithType> {
  const accepted = await publish(ctx, COMMANDS.aaCreate, { ...body, approvalType });
  return { ...accepted, approvalType };
}

export async function finalizeAaCommand(ctx: RequestContext, id: string): Promise<Accepted> {
  return publish(ctx, COMMANDS.aaFinalize, { id });
}

export async function createTsCommand(
  ctx: RequestContext,
  body: Record<string, unknown>,
  sanctionType: string,
): Promise<AcceptedWithType> {
  const accepted = await publish(ctx, COMMANDS.tsCreate, { ...body, sanctionType });
  return { ...accepted, sanctionType };
}

export async function finalizeTsCommand(ctx: RequestContext, id: string): Promise<Accepted> {
  return publish(ctx, COMMANDS.tsFinalize, { id });
}
