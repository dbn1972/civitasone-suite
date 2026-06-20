import { randomUUID } from "node:crypto";
import type { RequestContext } from "@civitasone/types";
import { queue, cache } from "../../shared/infra.js";
import { COMMANDS } from "../../topics.js";
import type { CreateTicketBody, TicketNoteBody, CloseTicketBody } from "./validators.js";

export type Accepted = { id: string; status: string; correlationId: string };

export async function createTicket(ctx: RequestContext, body: CreateTicketBody): Promise<Accepted> {
  const id = randomUUID();
  await queue.publish(COMMANDS.ticketCreate, {
    messageId: id, type: COMMANDS.ticketCreate,
    tenantId: ctx.tenantId, actorId: ctx.actorId, correlationId: ctx.correlationId, schemaVersion: "1.0",
    payload: { id, tenantId: ctx.tenantId, ...body },
  });
  return { id, status: "accepted", correlationId: ctx.correlationId };
}

export async function addNote(ctx: RequestContext, id: string, body: TicketNoteBody): Promise<Accepted> {
  const noteId = randomUUID();
  await queue.publish(COMMANDS.ticketNote, {
    messageId: noteId, type: COMMANDS.ticketNote,
    tenantId: ctx.tenantId, actorId: ctx.actorId, correlationId: ctx.correlationId, schemaVersion: "1.0",
    payload: { id: noteId, ticketId: id, tenantId: ctx.tenantId, ...body },
  });
  await cache.invalidate(cache.makeKey(ctx.tenantId, "ticket", id));
  return { id: noteId, status: "accepted", correlationId: ctx.correlationId };
}

export async function closeTicket(ctx: RequestContext, id: string, body: CloseTicketBody): Promise<Accepted> {
  await queue.publish(COMMANDS.ticketClose, {
    type: COMMANDS.ticketClose,
    tenantId: ctx.tenantId, actorId: ctx.actorId, correlationId: ctx.correlationId, schemaVersion: "1.0",
    payload: { id, tenantId: ctx.tenantId, ...body },
  });
  await cache.invalidate(cache.makeKey(ctx.tenantId, "ticket", id));
  return { id, status: "accepted", correlationId: ctx.correlationId };
}
