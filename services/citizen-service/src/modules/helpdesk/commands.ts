import { randomUUID, createHash } from "node:crypto";
import type { RequestContext } from "@civitasone/types";
import { queue, cache } from "../../shared/infra.js";
import { COMMANDS } from "../../topics.js";
import type {
  CreateTicketBody, TicketNoteBody, CloseTicketBody,
  AssignTicketBody, ResolveTicketBody, EscalateTicketBody,
} from "./validators.js";

export type Accepted = { id: string; status: string; correlationId: string };

/**
 * P1-1: deterministic messageId so a retried close/assign/resolve (same ticket,
 * command, correlation) maps to the SAME messageId and dedupes via the outbox
 * markProcessed guard, instead of inserting a duplicate with a fresh randomUUID.
 */
function stableMessageId(ticketId: string, command: string, correlationId: string): string {
  // SQS envelope requires a valid UUID; format the digest as a UUID-shaped id so
  // the deterministic messageId is accepted AND still dedupes a retried command.
  const h = createHash("sha256").update(`${ticketId}|${command}|${correlationId}`).digest("hex");
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20, 32)}`;
}

export async function createTicket(ctx: RequestContext, body: CreateTicketBody & { citizenId: string }): Promise<Accepted> {
  const id = randomUUID();
  await queue.publish(COMMANDS.ticketCreate, {
    messageId: id, type: COMMANDS.ticketCreate,
    tenantId: ctx.tenantId, actorId: ctx.actorId, correlationId: ctx.correlationId, schemaVersion: "1.0",
    payload: { id, tenantId: ctx.tenantId, ticketNo: `HD-${id.slice(0, 8).toUpperCase()}`, ...body },
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
  // P1-1/P1-5: stable messageId so a redelivered close dedupes idempotently.
  await queue.publish(COMMANDS.ticketClose, {
    messageId: stableMessageId(id, COMMANDS.ticketClose, ctx.correlationId), type: COMMANDS.ticketClose,
    tenantId: ctx.tenantId, actorId: ctx.actorId, correlationId: ctx.correlationId, schemaVersion: "1.0",
    payload: { id, tenantId: ctx.tenantId, ...body },
  });
  await cache.invalidate(cache.makeKey(ctx.tenantId, "ticket", id));
  return { id, status: "accepted", correlationId: ctx.correlationId };
}

export async function assignTicket(ctx: RequestContext, id: string, body: AssignTicketBody): Promise<Accepted> {
  // P1-1/P1-5: stable messageId so a redelivered assign dedupes idempotently.
  await queue.publish(COMMANDS.ticketAssign, {
    messageId: stableMessageId(id, COMMANDS.ticketAssign, ctx.correlationId), type: COMMANDS.ticketAssign,
    tenantId: ctx.tenantId, actorId: ctx.actorId, correlationId: ctx.correlationId, schemaVersion: "1.0",
    payload: { id, tenantId: ctx.tenantId, assigneeId: body.assigneeId },
  });
  await cache.invalidate(cache.makeKey(ctx.tenantId, "ticket", id));
  return { id, status: "accepted", correlationId: ctx.correlationId };
}

export async function resolveTicket(ctx: RequestContext, id: string, body: ResolveTicketBody): Promise<Accepted> {
  // P1-1/P1-5: stable messageId so a redelivered resolve dedupes idempotently.
  await queue.publish(COMMANDS.ticketResolve, {
    messageId: stableMessageId(id, COMMANDS.ticketResolve, ctx.correlationId), type: COMMANDS.ticketResolve,
    tenantId: ctx.tenantId, actorId: ctx.actorId, correlationId: ctx.correlationId, schemaVersion: "1.0",
    payload: { id, tenantId: ctx.tenantId, ...body },
  });
  await cache.invalidate(cache.makeKey(ctx.tenantId, "ticket", id));
  return { id, status: "accepted", correlationId: ctx.correlationId };
}

export async function escalateTicket(ctx: RequestContext, id: string, body: EscalateTicketBody): Promise<Accepted> {
  const escalationId = randomUUID();
  await queue.publish(COMMANDS.ticketEscalate, {
    messageId: escalationId, type: COMMANDS.ticketEscalate,
    tenantId: ctx.tenantId, actorId: ctx.actorId, correlationId: ctx.correlationId, schemaVersion: "1.0",
    payload: { id: escalationId, ticketId: id, tenantId: ctx.tenantId, reason: body.reason },
  });
  await cache.invalidate(cache.makeKey(ctx.tenantId, "ticket", id));
  return { id: escalationId, status: "accepted", correlationId: ctx.correlationId };
}
