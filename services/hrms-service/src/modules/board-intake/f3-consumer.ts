import type { Queue } from "@civitasone/queue";
import { pino } from "pino";
import { and, eq, desc, asc, sql, inArray, isNull, isNotNull, ne, or, gt, lt, gte, lte } from "drizzle-orm";
import { db } from "../../shared/db.js";
import { enqueue, markProcessed } from "../../shared/outbox.js";
import { COMMANDS } from "../../topics.js";
import * as repo from "./repo.js";
const log = pino({ name: "hrms-f3-board-intake" });
export function registerF3_board_intake_Consumers(queue: Queue): void {
  queue.subscribe(COMMANDS.f3RouteWrite, async (msg) => {
    const p = msg.payload as Record<string, any>;
    const op = String(p.op ?? "");
    const ops = new Set([
      "board_intake_routes__0",
      "board_intake_routes__1",
    ]);
    if (!ops.has(op)) return;
    const body = p.body ?? {};
    const params = p.params ?? {};
    const id = (p.id as string) || (params.id as string);
    try {
      await db.transaction(async (tx) => {
        if (!(await markProcessed(tx, msg.messageId))) return;
        switch (op) {
          case "board_intake_routes__0": {
            await repo.review(tx, p.tenantId, id, "accepted", msg.actorId, body.note ?? null, row.version);
                  // TODO(choreography): this is the controlled hand-off point. A competent HR
                  // officer has accepted the board decision for action — invoke the normal
                  // create-flow here (e.g. raise a transfer/promotion/disciplinary order via
                  // the module's own command). Intentionally NOT auto-executed: the officer
                  // drives the real order through the service's existing validated route.
            break;
          }
          case "board_intake_routes__1": {
            await repo.review(tx, p.tenantId, id, "rejected", msg.actorId, body.note, row.version);
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
