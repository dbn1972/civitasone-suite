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
            // TX-001: was repo.transitionRti(), a bare call that opens its
            // own db.transaction() -- nested inside this consumer's already-
            // open outer tx, that has no free pool connection to open on
            // under pool.max concurrent in-flight rti-transition commands
            // and deadlocks the pool silently. Route through the outer tx.
            const r1 = await repo.transitionRtiTx(tx, p.tenantId, id, msg.actorId, {
              from: ["filed"], to: "assigned", set: { pioId: body.pioId },
            });
            // SEC/CORRECTNESS: transitionRtiTx returns null when its guarded
            // WHERE clause matched zero rows -- not found, or (the race this
            // closes) a concurrent transition already moved the row out of
            // `from` between this route's own pre-check SELECT and this
            // write. That used to fall straight through to `break`, so
            // markProcessed() (already called above) permanently recorded
            // the message as done with NO error, NO retry and NO DLQ entry --
            // a silently no-op'd state transition. Throwing here instead
            // rolls back this transaction (markProcessed's insert included)
            // and surfaces to the same catch-and-rethrow below every other
            // op already relies on for retry/DLQ.
            if (!r1) throw new Error(`rti_routes__1: guarded transition to 'assigned' found no row in status 'filed' for id=${id}`);
            break;
          }
          case "rti_routes__2": {
            const r2 = await repo.transitionRtiTx(tx, p.tenantId, id, msg.actorId, {
              from: ["filed", "assigned"], to: "responded",
              set: { responseText: body.responseText, respondedDate: body.respondedDate },
            });
            if (!r2) throw new Error(`rti_routes__2: guarded transition to 'responded' found no row in status 'filed'/'assigned' for id=${id}`);
            break;
          }
          case "rti_routes__3": {
            const r3 = await repo.transitionRtiTx(tx, p.tenantId, id, msg.actorId, {
              from: ["responded"], to: "appealed",
              set: { appealText: body.appealText, appealDate: body.appealDate },
            });
            if (!r3) throw new Error(`rti_routes__3: guarded transition to 'appealed' found no row in status 'responded' for id=${id}`);
            break;
          }
          case "rti_routes__4": {
            const r4 = await repo.transitionRtiTx(tx, p.tenantId, id, msg.actorId, {
              from: ["responded", "appealed"], to: "closed",
              set: { closedDate: body.closedDate },
            });
            if (!r4) throw new Error(`rti_routes__4: guarded transition to 'closed' found no row in status 'responded'/'appealed' for id=${id}`);
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
