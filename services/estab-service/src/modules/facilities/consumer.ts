import type { Queue } from "@civitasone/queue";
import { db } from "../../shared/db.js";
import { cache } from "../../shared/infra.js";
import { enqueue, markProcessed } from "../../shared/outbox.js";
import { COMMANDS, EVENTS } from "../../topics.js";
import * as repo from "./repo.js";
import { checkNoRoomOverlap } from "./domain.js";

const AUDIT_TOPIC = "audit.event.record";

export function registerFacilitiesConsumers(queue: Queue): void {
  queue.subscribe(COMMANDS.guesthouseCreate, async (msg) => {
    const p = msg.payload as { id: string; tenantId: string; name: string; location?: string; contact?: string };
    await db.transaction(async (tx) => {
      if (!(await markProcessed(tx, msg.messageId))) return;
      await repo.insertGuesthouse(tx, {
        id: p.id, tenantId: p.tenantId, name: p.name,
        location: p.location ?? null, contact: p.contact ?? null, status: "active",
        createdBy: msg.actorId, updatedBy: msg.actorId,
      });
      await audit(tx, msg, "create", "guesthouse", p.id);
    });
  });

  queue.subscribe(COMMANDS.roomBook, async (msg) => {
    const p = msg.payload as { id: string; roomId: string; tenantId: string; guestName: string; guestRef?: string; checkIn: string; checkOut: string; sponsorDept?: string };
    const existing = await repo.findBookingsByRoom(p.roomId);
    const checkIn  = new Date(p.checkIn);
    const checkOut = new Date(p.checkOut);

    try {
      checkNoRoomOverlap(existing, checkIn, checkOut);
    } catch {
      await db.transaction(async (tx) => {
        if (!(await markProcessed(tx, msg.messageId))) return;
        await enqueue(tx, {
          topic: EVENTS.roomConflict, eventType: EVENTS.roomConflict,
          tenantId: msg.tenantId, actorId: msg.actorId, correlationId: msg.correlationId,
          payload: { roomId: p.roomId, requestedBy: p.guestRef ?? p.guestName, checkIn: p.checkIn, checkOut: p.checkOut },
        });
      });
      return;
    }

    await db.transaction(async (tx) => {
      if (!(await markProcessed(tx, msg.messageId))) return;
      await repo.insertRoomBooking(tx, {
        id: p.id, tenantId: p.tenantId, roomId: p.roomId,
        guestName: p.guestName, guestRef: p.guestRef ?? null,
        checkIn, checkOut, sponsorDept: p.sponsorDept ?? null,
        chargesMinor: 0n, currency: "INR", status: "booked",
        createdBy: msg.actorId, updatedBy: msg.actorId,
      });
      await audit(tx, msg, "book", "room_booking", p.id);
    });
  });

  queue.subscribe(COMMANDS.roomCheckin, async (msg) => {
    const p = msg.payload as { bookingId: string; tenantId: string };
    await db.transaction(async (tx) => {
      if (!(await markProcessed(tx, msg.messageId))) return;
      await repo.updateRoomBooking(tx, p.bookingId, { status: "checked_in", updatedBy: msg.actorId });
      await audit(tx, msg, "checkin", "room_booking", p.bookingId);
    });
    await cache.invalidate(cache.makeKey(msg.tenantId, "room_booking", p.bookingId));
  });

  queue.subscribe(COMMANDS.roomCheckout, async (msg) => {
    const p = msg.payload as { bookingId: string; tenantId: string; chargesMinor: number };
    await db.transaction(async (tx) => {
      if (!(await markProcessed(tx, msg.messageId))) return;
      await repo.updateRoomBooking(tx, p.bookingId, {
        status: "checked_out", chargesMinor: BigInt(p.chargesMinor), updatedBy: msg.actorId,
      });
      await audit(tx, msg, "checkout", "room_booking", p.bookingId);
    });
    await cache.invalidate(cache.makeKey(msg.tenantId, "room_booking", p.bookingId));
  });

  queue.subscribe(COMMANDS.libraryAdd, async (msg) => {
    const p = msg.payload as { id: string; tenantId: string; accessionNo: string; title: string; author?: string; isbn?: string; category?: string; copiesTotal: number };
    await db.transaction(async (tx) => {
      if (!(await markProcessed(tx, msg.messageId))) return;
      await repo.insertLibraryBook(tx, {
        id: p.id, tenantId: p.tenantId, accessionNo: p.accessionNo, title: p.title,
        author: p.author ?? null, isbn: p.isbn ?? null, category: p.category ?? null,
        copiesTotal: p.copiesTotal, copiesAvailable: p.copiesTotal,
        createdBy: msg.actorId, updatedBy: msg.actorId,
      });
      await audit(tx, msg, "add", "library_book", p.id);
    });
  });

  queue.subscribe(COMMANDS.libraryIssue, async (msg) => {
    const p = msg.payload as { id: string; bookId: string; tenantId: string; employeeRef: string; dueAt: string };
    await db.transaction(async (tx) => {
      if (!(await markProcessed(tx, msg.messageId))) return;
      await repo.decrementCopies(tx, p.bookId);
      await repo.insertIssue(tx, {
        id: p.id, tenantId: p.tenantId, bookId: p.bookId,
        employeeRef: p.employeeRef, dueAt: new Date(p.dueAt),
        status: "issued", createdBy: msg.actorId, updatedBy: msg.actorId,
      });
      await audit(tx, msg, "issue", "library_issue", p.id);
    });
  });

  queue.subscribe(COMMANDS.libraryReturn, async (msg) => {
    const p = msg.payload as { issueId: string; tenantId: string };
    await db.transaction(async (tx) => {
      if (!(await markProcessed(tx, msg.messageId))) return;
      const issue = await repo.getIssueByIdTx(tx, p.issueId);
      if (!issue) return;
      // Idempotent: a second return for the same loan is a no-op (already
      // returned) — do not double-increment copiesAvailable.
      if (issue.status === "returned") return;
      await repo.markIssueReturned(tx, p.issueId, new Date(), msg.actorId);
      await repo.incrementCopies(tx, issue.bookId);
      await audit(tx, msg, "return", "library_issue", p.issueId);
      await enqueue(tx, {
        topic: EVENTS.libraryReturned, eventType: EVENTS.libraryReturned,
        tenantId: msg.tenantId, actorId: msg.actorId, correlationId: msg.correlationId,
        payload: { issueId: p.issueId, bookId: issue.bookId },
      });
    });
  });

  queue.subscribe(COMMANDS.libraryRenew, async (msg) => {
    const p = msg.payload as { issueId: string; tenantId: string; dueAt: string };
    await db.transaction(async (tx) => {
      if (!(await markProcessed(tx, msg.messageId))) return;
      const issue = await repo.getIssueByIdTx(tx, p.issueId);
      if (!issue || issue.status === "returned") return;
      await repo.updateIssueDueAt(tx, p.issueId, new Date(p.dueAt), msg.actorId);
      await audit(tx, msg, "renew", "library_issue", p.issueId);
      await enqueue(tx, {
        topic: EVENTS.libraryRenewed, eventType: EVENTS.libraryRenewed,
        tenantId: msg.tenantId, actorId: msg.actorId, correlationId: msg.correlationId,
        payload: { issueId: p.issueId, dueAt: p.dueAt },
      });
    });
  });
}

async function audit(tx: any, msg: any, action: string, resourceType: string, resourceId: string): Promise<void> {
  await enqueue(tx, {
    topic: AUDIT_TOPIC, eventType: AUDIT_TOPIC,
    tenantId: msg.tenantId, actorId: msg.actorId, correlationId: msg.correlationId,
    payload: { service: "estab", action, resourceType, resourceId, outcome: "success" },
  });
}
