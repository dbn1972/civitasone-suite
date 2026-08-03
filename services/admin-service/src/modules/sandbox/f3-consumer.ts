import type { Queue } from "@civitasone/queue";
import { pino } from "pino";
import { db } from "../../shared/db.js";
import { markProcessed } from "../../shared/outbox.js";
import { COMMANDS } from "../../topics.js";
import { apply_sandbox_0, apply_sandbox_1, apply_sandbox_2, apply_sandbox_3, apply_sandbox_4 } from "./f3-apply.js";

const log = pino({ name: "admin-f3-sandbox" });

export function registerF3_sandbox_Consumers(queue: Queue): void {
  queue.subscribe(COMMANDS.f3RouteWrite, async (msg) => {
    const p = msg.payload as Record<string, any>;
    const op = String(p.op ?? "");
    const ops = new Set(['sandbox_op_0', 'sandbox_op_1', 'sandbox_op_2', 'sandbox_op_3', 'sandbox_op_4']);
    if (!ops.has(op)) return;
    const ctx = { tenantId: msg.tenantId, actorId: msg.actorId, correlationId: msg.correlationId };
    try {
      let ok = false;
      await db.transaction(async (tx) => { ok = await markProcessed(tx, msg.messageId); });
      if (!ok) return;
      switch (op) {
      case 'sandbox_op_0': {
        await apply_sandbox_0(ctx, { body: p.body, params: p.params, query: p.query });
        break;
      }
      case 'sandbox_op_1': {
        await apply_sandbox_1(ctx, { body: p.body, params: p.params, query: p.query });
        break;
      }
      case 'sandbox_op_2': {
        await apply_sandbox_2(ctx, { body: p.body, params: p.params, query: p.query });
        break;
      }
      case 'sandbox_op_3': {
        await apply_sandbox_3(ctx, { body: p.body, params: p.params, query: p.query });
        break;
      }
      case 'sandbox_op_4': {
        await apply_sandbox_4(ctx, { body: p.body, params: p.params, query: p.query });
        break;
      }
      }
    } catch (err) {
      log.error({ err, op, messageId: msg.messageId }, "f3RouteWrite failed");
      throw err;
    }
  });
}
