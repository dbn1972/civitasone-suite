import { randomUUID } from "node:crypto";
import type { RequestContext } from "@civitasone/types";
import { queue, cache } from "../../shared/infra.js";
import { db } from "../../shared/db.js";
import { COMMANDS } from "../../topics.js";
import * as repo from "./repo.js";
import { checkNoRoomOverlap } from "./domain.js";
import { HttpError } from "../../shared/context.js";
import type { CreateGuesthouseBody, BookRoomBody, CheckoutBody, AddBookBody, IssueBookBody, RenewIssueBody } from "./validators.js";

export type Accepted = { id: string; status: string; correlationId: string };
export type Created = { id: string };

export async function createGuesthouse(ctx: RequestContext, body: CreateGuesthouseBody): Promise<Accepted> {
  const id = randomUUID();
  await queue.publish(COMMANDS.guesthouseCreate, {
    messageId: id, type: COMMANDS.guesthouseCreate,
    tenantId: ctx.tenantId, actorId: ctx.actorId, correlationId: ctx.correlationId, schemaVersion: "1.0",
    payload: { id, tenantId: ctx.tenantId, ...body },
  });
  return { id, status: "accepted", correlationId: ctx.correlationId };
}

export async function bookRoom(ctx: RequestContext, body: BookRoomBody): Promise<Created> {
  const existing = await repo.findBookingsByRoom(body.roomId);
  const checkIn = new Date(body.checkIn);
  const checkOut = new Date(body.checkOut);
  try {
    checkNoRoomOverlap(existing, checkIn, checkOut);
  } catch {
    throw new HttpError(409, "BOOKING_CONFLICT",
      "This room is already booked for the requested time. Choose a different slot.");
  }

  const id = randomUUID();
  await db.transaction(async (tx) => {
    await repo.insertRoomBooking(tx, {
      id, tenantId: ctx.tenantId, roomId: body.roomId,
      guestName: body.guestName, guestRef: body.guestRef ?? null,
      checkIn, checkOut, sponsorDept: body.sponsorDept ?? null,
      chargesMinor: 0n, currency: "INR", status: "booked",
      createdBy: ctx.actorId, updatedBy: ctx.actorId,
    });
  });
  await cache.invalidate(cache.makeKey(ctx.tenantId, "room_booking", id));
  return { id };
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
  const book = await repo.getLibraryBookById(ctx.tenantId, body.bookId);
  if (!book) throw new HttpError(404, "NOT_FOUND", "book not found");
  if (book.copiesAvailable <= 0) {
    throw new HttpError(409, "NO_COPIES_AVAILABLE", "no copies of this book are currently available");
  }
  const id = randomUUID();
  await queue.publish(COMMANDS.libraryIssue, {
    messageId: id, type: COMMANDS.libraryIssue,
    tenantId: ctx.tenantId, actorId: ctx.actorId, correlationId: ctx.correlationId, schemaVersion: "1.0",
    payload: { id, tenantId: ctx.tenantId, ...body },
  });
  return { id, status: "accepted", correlationId: ctx.correlationId };
}

export async function returnBook(ctx: RequestContext, issueId: string): Promise<Accepted> {
  const issue = await repo.getIssueById(ctx.tenantId, issueId);
  if (!issue) throw new HttpError(404, "NOT_FOUND", "issue not found");
  const messageId = randomUUID();
  await queue.publish(COMMANDS.libraryReturn, {
    messageId, type: COMMANDS.libraryReturn,
    tenantId: ctx.tenantId, actorId: ctx.actorId, correlationId: ctx.correlationId, schemaVersion: "1.0",
    payload: { issueId, tenantId: ctx.tenantId },
  });
  return { id: issueId, status: "accepted", correlationId: ctx.correlationId };
}

export async function renewBook(ctx: RequestContext, issueId: string, body: RenewIssueBody): Promise<Accepted> {
  const issue = await repo.getIssueById(ctx.tenantId, issueId);
  if (!issue) throw new HttpError(404, "NOT_FOUND", "issue not found");
  if (issue.status === "returned") {
    throw new HttpError(409, "ALREADY_RETURNED", "this issue has already been returned and cannot be renewed");
  }
  const messageId = randomUUID();
  await queue.publish(COMMANDS.libraryRenew, {
    messageId, type: COMMANDS.libraryRenew,
    tenantId: ctx.tenantId, actorId: ctx.actorId, correlationId: ctx.correlationId, schemaVersion: "1.0",
    payload: { issueId, tenantId: ctx.tenantId, dueAt: body.dueAt },
  });
  return { id: issueId, status: "accepted", correlationId: ctx.correlationId };
}
