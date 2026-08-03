// @ts-nocheck — generated F3 leftover consumer
import type { Queue } from "@civitasone/queue";
import { pino } from "pino";
import { and, eq } from "drizzle-orm";
import { db } from "../../shared/db.js";
import { markProcessed } from "../../shared/outbox.js";
import { COMMANDS } from "../../topics.js";
import * as repo from "./repo.js";
import { hrmsServiceBookEntries } from "./schema.js";

const log = pino({ name: "hrms-f3-service-book" });

export function registerF3_service_book_Consumers(queue: Queue): void {
  queue.subscribe(COMMANDS.f3RouteWrite, async (msg) => {
    const p = msg.payload as Record<string, any>;
    const op = String(p.op ?? "");
    const ops = new Set([
      "service_book_routes__0",
      "service_book_routes__1",
      "service_book_routes__2",
    ]);
    if (!ops.has(op)) return;
    const body = p.body ?? {};
    const params = p.params ?? {};
    const id = (p.id as string) || (params.entryId as string) || (params.id as string);
    try {
      await db.transaction(async (tx) => {
        if (!(await markProcessed(tx, msg.messageId))) return;
        switch (op) {
          case "service_book_routes__0": {
            const employeeId = String(params.id ?? "");
            await repo.insertServiceBookEntry(tx, {
              id,
              tenantId: p.tenantId,
              employeeId,
              recordedBy: msg.actorId,
              entryType: body.entryType,
              effectiveDate: body.effectiveDate,
              description: body.description,
              documentRef: body.documentRef ?? null,
            });
            break;
          }
          case "service_book_routes__1": {
            await tx.update(hrmsServiceBookEntries)
              .set({ description: body.description, documentRef: body.documentRef ?? null })
              .where(and(
                eq(hrmsServiceBookEntries.id, id),
                eq(hrmsServiceBookEntries.tenantId, p.tenantId),
              ));
            break;
          }
          case "service_book_routes__2": {
            await tx.update(hrmsServiceBookEntries)
              .set({
                attested: true,
                attestedBy: msg.actorId,
                attestedAt: new Date(),
                attestRemarks: body.remarks ?? null,
              })
              .where(and(
                eq(hrmsServiceBookEntries.id, id),
                eq(hrmsServiceBookEntries.tenantId, p.tenantId),
                eq(hrmsServiceBookEntries.attested, false),
              ));
            break;
          }
        }
      });
    } catch (err) {
      log.error({ err, op, messageId: msg.messageId }, "f3RouteWrite failed");
      throw err;
    }
  });
}
