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
      // SOD-FIX (see central-config/f3-consumer.ts for the full rationale):
      // claim idempotency AFTER apply_sandbox_N() succeeds, not before. apply_*
      // is atomic (own internal db.transaction), so claiming up front meant a
      // thrown business error — e.g. MAKER_CHECKER_VIOLATION when a sandbox
      // refresh's approver/rejecter is the same actor as the requester — got
      // marked "processed" before the work ran, so SQS's redelivery silently
      // no-op'd and the message never reached the dead-letter queue. Claiming
      // only on success restores real retry + DLQ visibility for a genuinely
      // poisoned message instead of it vanishing after one log line.
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
      await db.transaction(async (tx) => { await markProcessed(tx, msg.messageId); });
    } catch (err) {
      log.error({ err, op, messageId: msg.messageId }, "f3RouteWrite failed");
      throw err;
    }
  });
}
