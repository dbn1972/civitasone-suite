import { randomUUID } from "node:crypto";
import type { RequestContext } from "@civitasone/types";
import { queue } from "../../shared/infra.js";
import { COMMANDS } from "../../topics.js";

export type Accepted = { id: string; status: string; correlationId: string };

export async function upsertSlaPolicy(
  ctx: RequestContext,
  body: {
    priority: string;
    category?: string | null | undefined;
    responseMinutes: number;
    resolutionMinutes: number;
  },
): Promise<Accepted> {
  const id = randomUUID();
  await queue.publish(COMMANDS.slaPolicyUpsert, {
    messageId: id,
    type: COMMANDS.slaPolicyUpsert,
    tenantId: ctx.tenantId,
    actorId: ctx.actorId,
    correlationId: ctx.correlationId,
    schemaVersion: "1.0",
    payload: { id, tenantId: ctx.tenantId, ...body },
  });
  return { id, status: "accepted", correlationId: ctx.correlationId };
}

export async function submitCsat(
  ctx: RequestContext,
  body: { ticketId: string; rating: number; comment?: string | undefined },
): Promise<Accepted> {
  const id = randomUUID();
  await queue.publish(COMMANDS.csatSubmit, {
    messageId: id,
    type: COMMANDS.csatSubmit,
    tenantId: ctx.tenantId,
    actorId: ctx.actorId,
    correlationId: ctx.correlationId,
    schemaVersion: "1.0",
    payload: { id, tenantId: ctx.tenantId, ...body },
  });
  return { id, status: "accepted", correlationId: ctx.correlationId };
}

export async function escalateTicket(
  ctx: RequestContext,
  ticketId: string,
  body: { reason: string },
): Promise<Accepted> {
  const id = randomUUID();
  await queue.publish(COMMANDS.ticketEscalate, {
    messageId: id,
    type: COMMANDS.ticketEscalate,
    tenantId: ctx.tenantId,
    actorId: ctx.actorId,
    correlationId: ctx.correlationId,
    schemaVersion: "1.0",
    payload: { id, tenantId: ctx.tenantId, ticketId, ...body },
  });
  return { id, status: "accepted", correlationId: ctx.correlationId };
}
