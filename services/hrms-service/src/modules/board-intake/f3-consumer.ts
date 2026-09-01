import type { Queue } from "@civitasone/queue";
import { pino } from "pino";
import { and, eq, desc, asc, sql, inArray, isNull, isNotNull, ne, or, gt, lt, gte, lte } from "drizzle-orm";
import { db } from "../../shared/db.js";
import { enqueue, markProcessed } from "../../shared/outbox.js";
import { COMMANDS } from "../../topics.js";
import { hrmsBoardDecisionIntake } from "./schema.js";
import * as repo from "./repo.js";
const log = pino({ name: "hrms-f3-board-intake" });

/**
 * F3 leftover fix (same bug class as leave/f3-consumer `leave_policy_admin_routes__0`):
 * both cases below referenced an undefined `row` local — the code-gen tool dropped the
 * `const row = await repo.findById(...)` fetch that routes.ts still performs before it
 * publishes. Every accept/reject therefore threw a ReferenceError inside this async
 * consumer *after* the route had already answered 200 `{status:"accepted"}`, so the HR
 * officer was told the board decision was reviewed while the row stayed pending_review
 * forever.
 *
 * Second defect fixed here: routes.ts publishes `randomUUID()` as the message id, so the
 * generated `id` local below is a fresh UUID, NOT the intake item being reviewed. The
 * real target is `params.id` (the `:id` path segment), so each case resolves it explicitly.
 *
 * The record is re-read inside `tx` rather than via repo.findById (which opens its own
 * scopedRead transaction) so the version we pass to repo.review is read-your-own-writes
 * consistent with the UPDATE in the same transaction.
 */
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
    // The intake item under review — always the `:id` path param, never the message id.
    const intakeId = String(params.id ?? "");
    async function loadIntakeRow(tx: any) {
      const rows = await tx.select().from(hrmsBoardDecisionIntake)
        .where(and(
          eq(hrmsBoardDecisionIntake.tenantId, p.tenantId),
          eq(hrmsBoardDecisionIntake.id, intakeId),
        ))
        .limit(1);
      return rows[0] ?? null;
    }
    try {
      await db.transaction(async (tx) => {
        if (!(await markProcessed(tx, msg.messageId))) return;
        switch (op) {
          case "board_intake_routes__0": {
            const row = await loadIntakeRow(tx);
            if (!row) {
              log.warn({ op, intakeId, messageId: msg.messageId }, "intake item disappeared before async review");
              return;
            }
            await repo.review(tx, p.tenantId, intakeId, "accepted", msg.actorId, body.note ?? null, row.version);
                  // TODO(choreography): this is the controlled hand-off point. A competent HR
                  // officer has accepted the board decision for action — invoke the normal
                  // create-flow here (e.g. raise a transfer/promotion/disciplinary order via
                  // the module's own command). Intentionally NOT auto-executed: the officer
                  // drives the real order through the service's existing validated route.
            break;
          }
          case "board_intake_routes__1": {
            const row = await loadIntakeRow(tx);
            if (!row) {
              log.warn({ op, intakeId, messageId: msg.messageId }, "intake item disappeared before async review");
              return;
            }
            await repo.review(tx, p.tenantId, intakeId, "rejected", msg.actorId, body.note, row.version);
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
