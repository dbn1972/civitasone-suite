import type { Queue } from "@civitasone/queue";
import { pino } from "pino";
import { db } from "../../shared/db.js";
import { markProcessed } from "../../shared/outbox.js";
import { COMMANDS } from "../../topics.js";
import { apply_central_config_0, apply_central_config_1, apply_central_config_2 } from "./f3-apply.js";

const log = pino({ name: "admin-f3-central-config" });

export function registerF3_central_config_Consumers(queue: Queue): void {
  queue.subscribe(COMMANDS.f3RouteWrite, async (msg) => {
    const p = msg.payload as Record<string, any>;
    const op = String(p.op ?? "");
    const ops = new Set(['central_config_op_0', 'central_config_op_1', 'central_config_op_2']);
    if (!ops.has(op)) return;
    const ctx = { tenantId: msg.tenantId, actorId: msg.actorId, correlationId: msg.correlationId };
    try {
      // SOD-FIX: claim idempotency AFTER the business transaction succeeds, not
      // before. apply_central_config_N() is atomic — it wraps its own
      // db.transaction() internally and either fully commits or fully throws
      // (e.g. MAKER_CHECKER_VIOLATION when an approver tries to self-approve,
      // NOT_PENDING, or a transient DB error). Claiming "processed" up front (the
      // previous behaviour) meant any such throw was marked processed before the
      // work ran: SQS redelivers on the throw, the redelivery finds the message
      // already claimed and returns cleanly with no exception, and SQS deletes it
      // as an ordinary success. The action then silently never happens, is never
      // retried, never reaches the queue's native RedrivePolicy dead-letter queue,
      // and leaves no trace beyond one log line from the first attempt — including
      // for a self-approval attempt, which is exactly the case we most want a
      // durable trail for. Claiming only after success keeps a genuinely poison
      // message retryable and lets it reach the DLQ as designed instead of
      // vanishing. (Residual: a concurrent redelivery landing mid-flight, before
      // the claim commits, could re-run an apply_* — the per-op status/version
      // guards make this a harmless no-op for approve/reject/schedule/etc., and
      // only a narrow risk for the create/propose ops; full exactly-once would
      // need apply_* to accept a shared tx, a larger refactor left for follow-up.)
      switch (op) {
      case 'central_config_op_0': {
        await apply_central_config_0(ctx, { body: p.body, params: p.params, query: p.query });
        break;
      }
      case 'central_config_op_1': {
        await apply_central_config_1(ctx, { body: p.body, params: p.params, query: p.query });
        break;
      }
      case 'central_config_op_2': {
        await apply_central_config_2(ctx, { body: p.body, params: p.params, query: p.query });
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
