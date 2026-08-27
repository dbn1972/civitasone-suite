import type { Queue } from "@civitasone/queue";
import { pino } from "pino";
import { db } from "../../shared/db.js";
import { markProcessed } from "../../shared/outbox.js";
import { COMMANDS } from "../../topics.js";
import { apply_change_0, apply_change_1, apply_change_2, apply_change_3, apply_change_4, apply_change_5, apply_change_6, apply_change_7, apply_change_8 } from "./f3-apply.js";

const log = pino({ name: "admin-f3-change" });

export function registerF3_change_Consumers(queue: Queue): void {
  queue.subscribe(COMMANDS.f3RouteWrite, async (msg) => {
    const p = msg.payload as Record<string, any>;
    const op = String(p.op ?? "");
    const ops = new Set(['change_op_0', 'change_op_1', 'change_op_2', 'change_op_3', 'change_op_4', 'change_op_5', 'change_op_6', 'change_op_7', 'change_op_8']);
    if (!ops.has(op)) return;
    const ctx = { tenantId: msg.tenantId, actorId: msg.actorId, correlationId: msg.correlationId };
    try {
      // SOD-FIX (see central-config/f3-consumer.ts for the full rationale):
      // claim idempotency AFTER apply_change_N() succeeds, not before. apply_*
      // is atomic (own internal db.transaction), so claiming up front meant a
      // thrown business error — e.g. MAKER_CHECKER_VIOLATION when the CAB
      // approver/rejecter is the same actor as the requester — got marked
      // "processed" before the work ran, so SQS's redelivery silently no-op'd
      // and the message never reached the dead-letter queue. Claiming only on
      // success restores real retry + DLQ visibility for a genuinely poisoned
      // message instead of it vanishing after one log line.
      switch (op) {
      case 'change_op_0': {
        await apply_change_0(ctx, { body: p.body, params: p.params, query: p.query });
        break;
      }
      case 'change_op_1': {
        await apply_change_1(ctx, { body: p.body, params: p.params, query: p.query });
        break;
      }
      case 'change_op_2': {
        await apply_change_2(ctx, { body: p.body, params: p.params, query: p.query });
        break;
      }
      case 'change_op_3': {
        await apply_change_3(ctx, { body: p.body, params: p.params, query: p.query });
        break;
      }
      case 'change_op_4': {
        await apply_change_4(ctx, { body: p.body, params: p.params, query: p.query });
        break;
      }
      case 'change_op_5': {
        await apply_change_5(ctx, { body: p.body, params: p.params, query: p.query });
        break;
      }
      case 'change_op_6': {
        await apply_change_6(ctx, { body: p.body, params: p.params, query: p.query });
        break;
      }
      case 'change_op_7': {
        await apply_change_7(ctx, { body: p.body, params: p.params, query: p.query });
        break;
      }
      case 'change_op_8': {
        await apply_change_8(ctx, { body: p.body, params: p.params, query: p.query });
        break;
      }
      }
      await db.transaction(async (tx) => { await markProcessed(tx, msg.messageId); });
    } catch (err) {
      log.error({ err, op, messageId: msg.messageId }, "f3RouteWrite failed");
      throw err;
    }
  });
}
