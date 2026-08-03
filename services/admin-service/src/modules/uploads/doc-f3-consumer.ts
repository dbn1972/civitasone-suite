import type { Queue } from "@civitasone/queue";
import { pino } from "pino";
import { db } from "../../shared/db.js";
import { markProcessed } from "../../shared/outbox.js";
import { COMMANDS } from "../../topics.js";
import {
  apply_uploads_0,
  apply_uploads_1,
  apply_uploads_2,
  apply_uploads_3,
  apply_uploads_4,
} from "./doc-f3-apply.js";

const log = pino({ name: "admin-f3-uploads" });

export function registerF3_uploads_Consumers(queue: Queue): void {
  queue.subscribe(COMMANDS.f3RouteWrite, async (msg) => {
    const p = msg.payload as Record<string, any>;
    const op = String(p.op ?? "");
    const ops = new Set(["uploads_op_0", "uploads_op_1", "uploads_op_2", "uploads_op_3", "uploads_op_4"]);
    if (!ops.has(op)) return;
    const ctx = { tenantId: msg.tenantId, actorId: msg.actorId, correlationId: msg.correlationId };
    try {
      let ok = false;
      await db.transaction(async (tx) => {
        ok = await markProcessed(tx, msg.messageId);
      });
      if (!ok) return;
      const req = { body: p.body, params: p.params, query: p.query };
      switch (op) {
        case "uploads_op_0":
          await apply_uploads_0(ctx, req);
          break;
        case "uploads_op_1":
          await apply_uploads_1(ctx, req);
          break;
        case "uploads_op_2":
          await apply_uploads_2(ctx, req);
          break;
        case "uploads_op_3":
          await apply_uploads_3(ctx, req);
          break;
        case "uploads_op_4":
          await apply_uploads_4(ctx, req);
          break;
      }
    } catch (err) {
      log.error({ err, op, messageId: msg.messageId }, "f3RouteWrite failed");
      throw err;
    }
  });
}
