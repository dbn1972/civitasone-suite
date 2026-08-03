// @ts-nocheck — generated F3 leftover consumer; locals closed over from route txs
import type { Queue } from "@civitasone/queue";
import { pino } from "pino";
import { and, eq, desc, asc, sql, inArray, isNull, isNotNull, ne, or, gt, lt, gte, lte } from "drizzle-orm";
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
            break;
          }
          case "holidays_routes__1": {
            await tx.delete(hrmsHolidays).where(and(eq(hrmsHolidays.id, id), eq(hrmsHolidays.tenantId, p.tenantId)));
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
