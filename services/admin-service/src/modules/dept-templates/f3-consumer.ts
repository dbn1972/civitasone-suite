import type { Queue } from "@civitasone/queue";
import { pino } from "pino";
import { db } from "../../shared/db.js";
import { markProcessed } from "../../shared/outbox.js";
import { COMMANDS } from "../../topics.js";
import { apply_dept_templates_0, apply_dept_templates_1, apply_dept_templates_2 } from "./f3-apply.js";

const log = pino({ name: "admin-f3-dept-templates" });

export function registerF3_dept_templates_Consumers(queue: Queue): void {
  queue.subscribe(COMMANDS.f3RouteWrite, async (msg) => {
    const p = msg.payload as Record<string, any>;
    const op = String(p.op ?? "");
    const ops = new Set(['dept_templates_op_0', 'dept_templates_op_1', 'dept_templates_op_2']);
    if (!ops.has(op)) return;
    const ctx = { tenantId: msg.tenantId, actorId: msg.actorId, correlationId: msg.correlationId };
    try {
      let ok = false;
      await db.transaction(async (tx) => { ok = await markProcessed(tx, msg.messageId); });
      if (!ok) return;
      switch (op) {
      case 'dept_templates_op_0': {
        await apply_dept_templates_0(ctx, { body: p.body, params: p.params, query: p.query });
        break;
      }
      case 'dept_templates_op_1': {
        await apply_dept_templates_1(ctx, { body: p.body, params: p.params, query: p.query });
        break;
      }
      case 'dept_templates_op_2': {
        await apply_dept_templates_2(ctx, { body: p.body, params: p.params, query: p.query });
        break;
      }
      }
    } catch (err) {
      log.error({ err, op, messageId: msg.messageId }, "f3RouteWrite failed");
      throw err;
    }
  });
}
