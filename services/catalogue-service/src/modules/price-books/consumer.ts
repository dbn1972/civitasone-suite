import { pino } from "pino";
import type { Queue } from "@civitasone/queue";
import { db } from "../../shared/db.js";
import { enqueue, markProcessed } from "../../shared/outbox.js";
import { writeAudit } from "../../shared/audit.js";
import { tenantScoped } from "../../shared/tenant-queue.js";
import { COMMANDS, EVENTS } from "../../topics.js";
import * as repo from "./repo.js";

const log = pino({ name: "catalogue.price-books.consumer" });

function ctxOf(msg: { tenantId: string; actorId: string; correlationId: string }) {
  return { tenantId: msg.tenantId, actorId: msg.actorId, correlationId: msg.correlationId };
}

export function registerPriceBookConsumers(rawQueue: Queue): void {
  const queue = tenantScoped(rawQueue);

  queue.subscribe(COMMANDS.createPriceBook, async (msg) => {
    const p = msg.payload as {
      id: string;
      name: string;
      segment: string;
      currency: string;
      geography: Record<string, unknown>;
      effectiveFrom: string;
      effectiveTo: string | null;
      status: string;
    };
    await db.transaction(async (tx) => {
      if (!(await markProcessed(tx, msg.messageId))) return;
      await repo.insertPriceBook(tx, {
        id: p.id,
        tenantId: msg.tenantId,
        name: p.name,
        segment: p.segment,
        currency: p.currency,
        geography: p.geography,
        effectiveFrom: new Date(p.effectiveFrom),
        effectiveTo: p.effectiveTo ? new Date(p.effectiveTo) : null,
        status: p.status,
        createdBy: msg.actorId,
        updatedBy: msg.actorId,
        version: 1,
      });
      await enqueue(tx, {
        topic: EVENTS.priceBookCreated,
        eventType: EVENTS.priceBookCreated,
        tenantId: msg.tenantId,
        actorId: msg.actorId,
        correlationId: msg.correlationId,
        payload: {
          priceBookId: p.id,
          name: p.name,
          segment: p.segment,
          currency: p.currency,
          status: p.status,
        },
      });
      await writeAudit(tx, ctxOf(msg), {
        action: "price_book.create",
        resourceType: "catalogue_price_book",
        resourceId: p.id,
      });
    });
    log.info({ id: p.id }, "price book created");
  });

  queue.subscribe(COMMANDS.updatePriceBook, async (msg) => {
    const p = msg.payload as {
      id: string;
      version: number;
      patch: Record<string, unknown>;
    };
    const patch = { ...p.patch };
    for (const key of ["effectiveFrom", "effectiveTo"] as const) {
      const v = patch[key];
      if (typeof v === "string") patch[key] = new Date(v);
    }
    await db.transaction(async (tx) => {
      if (!(await markProcessed(tx, msg.messageId))) return;
      const ok = await repo.updatePriceBook(tx, p.id, msg.tenantId, patch as never, p.version);
      if (!ok) return;
      await enqueue(tx, {
        topic: EVENTS.priceBookUpdated,
        eventType: EVENTS.priceBookUpdated,
        tenantId: msg.tenantId,
        actorId: msg.actorId,
        correlationId: msg.correlationId,
        payload: { priceBookId: p.id, patch: p.patch, previousVersion: p.version },
      });
      await writeAudit(tx, ctxOf(msg), {
        action: "price_book.update",
        resourceType: "catalogue_price_book",
        resourceId: p.id,
      });
    });
  });

  queue.subscribe(COMMANDS.replacePriceBookEntries, async (msg) => {
    const p = msg.payload as {
      priceBookId: string;
      entries: Array<{ id: string; productId: string; amountMinor: string; currency: string }>;
      totalAmountMinor: string;
    };
    await db.transaction(async (tx) => {
      if (!(await markProcessed(tx, msg.messageId))) return;
      await repo.replaceEntries(
        tx,
        p.priceBookId,
        msg.tenantId,
        p.entries.map((e) => ({
          id: e.id,
          tenantId: msg.tenantId,
          priceBookId: p.priceBookId,
          productId: e.productId,
          amountMinor: BigInt(e.amountMinor),
          currency: e.currency,
          createdBy: msg.actorId,
          updatedBy: msg.actorId,
          version: 1,
        })),
      );
      await enqueue(tx, {
        topic: EVENTS.priceBookEntriesReplaced,
        eventType: EVENTS.priceBookEntriesReplaced,
        tenantId: msg.tenantId,
        actorId: msg.actorId,
        correlationId: msg.correlationId,
        payload: {
          priceBookId: p.priceBookId,
          entryCount: p.entries.length,
          totalAmountMinor: p.totalAmountMinor,
        },
      });
      await writeAudit(tx, ctxOf(msg), {
        action: "price_book.entries.replace",
        resourceType: "catalogue_price_book",
        resourceId: p.priceBookId,
        details: { entryCount: p.entries.length },
      });
    });
  });
}
