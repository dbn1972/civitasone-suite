// @ts-nocheck — generated F3 leftover consumer; locals closed over from route txs
import type { Queue } from "@civitasone/queue";
import { pino } from "pino";
import { and, eq } from "drizzle-orm";
import { db } from "../../shared/db.js";
import { enqueue, markProcessed } from "../../shared/outbox.js";
import { COMMANDS } from "../../topics.js";
import { hrmsHolidays } from "./schema.js";
const log = pino({ name: "hrms-f3-holidays" });
export function registerF3_holidays_Consumers(queue: Queue): void {
  queue.subscribe(COMMANDS.f3RouteWrite, async (msg) => {
    const p = msg.payload as Record<string, any>;
    const op = String(p.op ?? "");
    const ops = new Set([
      "holidays_routes__0",
      "holidays_routes__1",
    ]);
    if (!ops.has(op)) return;
    const body = p.body ?? {};
    const params = p.params ?? {};
    const id = (p.id as string) || (params.id as string);
    try {
      await db.transaction(async (tx) => {
        if (!(await markProcessed(tx, msg.messageId))) return;
        switch (op) {
          case "holidays_routes__0": {
            await tx.insert(hrmsHolidays).values({ id, tenantId: p.tenantId, name: body.name, date: body.date, type: body.type, applicableTo: body.applicableTo, createdBy: msg.actorId });
            await enqueue(tx, {
              topic: "audit.event.record", eventType: "audit.event.record",
              tenantId: p.tenantId, actorId: msg.actorId, correlationId: msg.correlationId,
              payload: {
                service: "hrms", action: "create", resourceType: "holiday", resourceId: id, outcome: "success",
                metadata: { name: body.name, date: body.date, type: body.type, applicableTo: body.applicableTo },
              },
            });
            break;
          }
          case "holidays_routes__1": {
            // GAP-HR-HOLIDAYS-06: `id` is the real holiday id (the route now queues
            // it as the op id). RETURNING tells us whether a row really went, so
            // the audit event is only written for a deletion that happened.
            const removed = await tx.delete(hrmsHolidays)
              .where(and(eq(hrmsHolidays.id, id), eq(hrmsHolidays.tenantId, p.tenantId)))
              .returning({ id: hrmsHolidays.id, name: hrmsHolidays.name, date: hrmsHolidays.date, type: hrmsHolidays.type, applicableTo: hrmsHolidays.applicableTo });
            if (removed.length === 0) {
              log.warn({ op, id, messageId: msg.messageId }, "holiday missing before async delete");
              return;
            }
            await enqueue(tx, {
              topic: "audit.event.record", eventType: "audit.event.record",
              tenantId: p.tenantId, actorId: msg.actorId, correlationId: msg.correlationId,
              payload: {
                service: "hrms", action: "delete", resourceType: "holiday", resourceId: id, outcome: "success",
                metadata: { name: removed[0].name, date: removed[0].date, type: removed[0].type, applicableTo: removed[0].applicableTo },
              },
            });
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
