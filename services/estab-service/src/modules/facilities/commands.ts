import { randomUUID } from "node:crypto";
import type { RequestContext } from "@civitasone/types";
import { queue, cache } from "../../shared/infra.js";
import { COMMANDS } from "../../topics.js";
import type { CreateGuesthouseBody, BookRoomBody, CheckoutBody, AddBookBody, IssueBookBody } from "./validators.js";

export type Accepted = { id: string; status: string; correlationId: string };

export async function createGuesthouse(ctx: RequestContext, body: CreateGuesthouseBody): Promise<Accepted> {
  const id = randomUUID();
  await queue.publish(COMMANDS.guesthouseCreate, {
    messageId: id, type: COMMANDS.guesthouseCreate,
    tenantId: ctx.tenantId, actorId: ctx.actorId, correlationId: ctx.correlationId, schemaVersion: "1.0",
    payload: { id, tenantId: ctx.tenantId, ...body },
  });
  return { id, status: "accepted", correlationId: ctx.correlationId };
}

export async function bookRoom(ctx: RequestContext, body: BookRoomBody): Promise<Accepted> {
  const id = randomUUID();
  await queue.publish(COMMANDS.roomBook, {
    messageId: id, type: COMMANDS.roomBook,
    tenantId: ctx.tenantId, actorId: ctx.actorId, correlationId: ctx.correlationId, schemaVersion: "1.0",
    payload: { id, tenantId: ctx.tenantId, ...body },
  });
  return { id, status: "accepted", correlationId: ctx.correlationId };
}

export async function checkin(ctx: RequestContext, bookingId: string): Promise<Accepted> {
  await queue.publish(COMMANDS.roomCheckin, {
    type: COMMANDS.roomCheckin,
    tenantId: ctx.tenantId, actorId: ctx.actorId, correlationId: ctx.correlationId, schemaVersion: "1.0",
    payload: { bookingId, tenantId: ctx.tenantId },
  });
  await cache.invalidate(cache.makeKey(ctx.tenantId, "room_booking", bookingId));
  return { id: bookingId, status: "accepted", correlationId: ctx.correlationId };
}

export async function checkout(ctx: RequestContext, bookingId: string, body: CheckoutBody): Promise<Accepted> {
  await queue.publish(COMMANDS.roomCheckout, {
    type: COMMANDS.roomCheckout,
    tenantId: ctx.tenantId, actorId: ctx.actorId, correlationId: ctx.correlationId, schemaVersion: "1.0",
    payload: { bookingId, tenantId: ctx.tenantId, ...body },
  });
  await cache.invalidate(cache.makeKey(ctx.tenantId, "room_booking", bookingId));
  return { id: bookingId, status: "accepted", correlationId: ctx.correlationId };
}

export async function addBook(ctx: RequestContext, body: AddBookBody): Promise<Accepted> {
  const id = randomUUID();
  await queue.publish(COMMANDS.libraryAdd, {
    messageId: id, type: COMMANDS.libraryAdd,
    tenantId: ctx.tenantId, actorId: ctx.actorId, correlationId: ctx.correlationId, schemaVersion: "1.0",
    payload: { id, tenantId: ctx.tenantId, ...body },
  });
  return { id, status: "accepted", correlationId: ctx.correlationId };
}

export async function issueBook(ctx: RequestContext, body: IssueBookBody): Promise<Accepted> {
  const id = randomUUID();
  await queue.publish(COMMANDS.libraryIssue, {
    messageId: id, type: COMMANDS.libraryIssue,
    tenantId: ctx.tenantId, actorId: ctx.actorId, correlationId: ctx.correlationId, schemaVersion: "1.0",
    payload: { id, tenantId: ctx.tenantId, ...body },
  });
  return { id, status: "accepted", correlationId: ctx.correlationId };
}
