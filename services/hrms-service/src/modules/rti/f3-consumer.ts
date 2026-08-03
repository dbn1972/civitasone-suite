// @ts-nocheck — generated F3 leftover consumer; locals closed over from route txs
import type { Queue } from "@civitasone/queue";
import { pino } from "pino";
import { and, eq, desc, asc, sql, inArray, isNull, isNotNull, ne, or, gt, lt, gte, lte } from "drizzle-orm";
import { db } from "../../shared/db.js";
import { enqueue, markProcessed } from "../../shared/outbox.js";
import { COMMANDS } from "../../topics.js";
import * as repo from "./repo.js";
const log = pino({ name: "hrms-f3-rti" });
export function registerF3_rti_Consumers(queue: Queue): void {
  queue.subscribe(COMMANDS.f3RouteWrite, async (msg) => {
    const p = msg.payload as Record<string, any>;
    const op = String(p.op ?? "");
    const ops = new Set([
      "rti_routes__0",
    ]);
    if (!ops.has(op)) return;
    const body = p.body ?? {};
    const params = p.params ?? {};
    const id = (p.id as string) || (params.id as string);
    try {
      await db.transaction(async (tx) => {
        if (!(await markProcessed(tx, msg.messageId))) return;
        switch (op) {
          case "rti_routes__0": {
            await repo.insertRti(tx, {
                    id, tenantId: p.tenantId, createdBy: msg.actorId, updatedBy: msg.actorId,
                    referenceNo: body.referenceNo,
                    applicantName: body.applicantName,
                    applicantContact: body.applicantContact ?? null,
                    subject: body.subject,
                    requestText: body.requestText,
                    receivedDate: body.receivedDate,
                    dueDate,
                    status: "filed",
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
