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

async function pub(
  ctx: RequestContext,
  type: string,
  id: string,
  payload: Record<string, unknown>,
): Promise<Accepted> {
  await queue.publish(type, {
    messageId: id,
    type,
    tenantId: ctx.tenantId,
    actorId: ctx.actorId,
    correlationId: ctx.correlationId,
    schemaVersion: "1.0",
    payload: { ...payload, id, tenantId: ctx.tenantId },
  });
  return { id, status: "accepted", correlationId: ctx.correlationId };
}

export const createCalendar = (
  ctx: RequestContext,
  body: { name: string; timezone: string; workDays: unknown[]; holidays: unknown[] },
) => pub(ctx, COMMANDS.calendarCreate, randomUUID(), body);

export const updateCalendar = (
  ctx: RequestContext,
  id: string,
  body: { name?: string; timezone?: string; workDays?: unknown[]; holidays?: unknown[]; expectedVersion: number },
) => pub(ctx, COMMANDS.calendarUpdate, id, body);

export const pauseSla = (ctx: RequestContext, ticketId: string, body: { pauseStatus: string }) =>
  pub(ctx, COMMANDS.slaPause, randomUUID(), { ticketId, ...body });

export const resumeSla = (ctx: RequestContext, ticketId: string) =>
  pub(ctx, COMMANDS.slaResume, randomUUID(), { ticketId });

export const extendSla = (
  ctx: RequestContext,
  ticketId: string,
  body: { additionalMinutes: number; reason: string; approverId: string },
) => pub(ctx, COMMANDS.slaExtend, randomUUID(), { ticketId, ...body });

export const submitCes = (
  ctx: RequestContext,
  body: { ticketId: string; effortScore: number; comment?: string | undefined },
) => pub(ctx, COMMANDS.cesSubmit, randomUUID(), body);
