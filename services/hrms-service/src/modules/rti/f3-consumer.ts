// @ts-nocheck — generated F3 leftover consumer
import type { Queue } from "@civitasone/queue";
import { pino } from "pino";
import { db } from "../../shared/db.js";
import { markProcessed } from "../../shared/outbox.js";
import { COMMANDS } from "../../topics.js";
import * as repo from "./repo.js";

const log = pino({ name: "hrms-f3-rti" });

export function registerF3_rti_Consumers(queue: Queue): void {
  queue.subscribe(COMMANDS.f3RouteWrite, async (msg) => {
    const p = msg.payload as Record<string, any>;
    const op = String(p.op ?? "");
    const ops = new Set([
      "rti_routes__0",
      "rti_routes__1",
      "rti_routes__2",
      "rti_routes__3",
      "rti_routes__4",
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
              id,
              tenantId: p.tenantId,
              createdBy: msg.actorId,
              updatedBy: msg.actorId,
              referenceNo: body.referenceNo,
              applicantName: body.applicantName,
              applicantContact: body.applicantContact ?? null,
              subject: body.subject,
              requestText: body.requestText,
              receivedDate: body.receivedDate,
              dueDate: body.dueDate,
              status: "filed",
            });
            break;
          }
          case "rti_routes__1": {
            await repo.transitionRti(p.tenantId, id, msg.actorId, {
              from: ["filed"], to: "assigned", set: { pioId: body.pioId },
            });
            break;
          }
          case "rti_routes__2": {
            await repo.transitionRti(p.tenantId, id, msg.actorId, {
              from: ["filed", "assigned"], to: "responded",
              set: { responseText: body.responseText, respondedDate: body.respondedDate },
            });
            break;
          }
          case "rti_routes__3": {
            await repo.transitionRti(p.tenantId, id, msg.actorId, {
              from: ["responded"], to: "appealed",
              set: { appealText: body.appealText, appealDate: body.appealDate },
            });
            break;
          }
          case "rti_routes__4": {
            await repo.transitionRti(p.tenantId, id, msg.actorId, {
              from: ["responded", "appealed"], to: "closed",
              set: { closedDate: body.closedDate },
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
