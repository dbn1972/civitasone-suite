import { randomUUID } from "node:crypto";
import type { Queue } from "@civitasone/queue";
import { pino } from "pino";
import { and, eq, desc, asc, sql, inArray, isNull, isNotNull, ne, or, gt, lt, gte, lte } from "drizzle-orm";
import { db } from "../../shared/db.js";
import { enqueue, markProcessed } from "../../shared/outbox.js";
import { COMMANDS } from "../../topics.js";
import { hrms360Feedback, hrmsAparDisclosures, hrmsRatingAppeals } from "./schema.js";
const log = pino({ name: "hrms-f3-appraisals" });

/**
 * F3 leftover fix (same bug class as leave/f3-consumer `leave_policy_admin_routes__0`):
 * all three cases referenced undefined `fid` / `did` / `aid` locals. feedback-routes.ts
 * still computes each one (`const fid = randomUUID()` etc.) and returns it to the client
 * as the created row's id, but the code-gen tool moved the INSERT here without the
 * declaration. So every 360-feedback submission, APAR disclosure and rating appeal threw
 * a ReferenceError inside this consumer *after* the route had already answered 201 with
 * an id — the row was never written and the id handed to the caller pointed at nothing.
 *
 * Second defect fixed here: feedback-routes.ts publishes `randomUUID()` as the message id,
 * so the generated `id` local is a fresh UUID rather than the appraisal being written
 * against. `appraisalId` must come from the `:id` path param, otherwise these inserts
 * carry a dangling appraisal reference. Each case resolves `params.id` explicitly.
 *
 * NOTE: the row ids generated here cannot match the `fid`/`did`/`aid` the route already
 * returned to the client (the route's UUIDs are not carried in the queue payload). The
 * write is now correct and durable; reconciling the returned id with the stored id needs
 * the route to publish its own UUID as the message id — see the report accompanying this
 * change. `pipLinked` mirrors the route's Zod `.default(false)`.
 */
export function registerF3_appraisals_Consumers(queue: Queue): void {
  queue.subscribe(COMMANDS.f3RouteWrite, async (msg) => {
    const p = msg.payload as Record<string, any>;
    const op = String(p.op ?? "");
    const ops = new Set([
      "appraisals_feedback_routes__0",
      "appraisals_feedback_routes__1",
      "appraisals_feedback_routes__2",
    ]);
    if (!ops.has(op)) return;
    const body = p.body ?? {};
    const params = p.params ?? {};
    const id = (p.id as string) || (params.id as string);
    // The appraisal these child rows hang off — always the `:id` path segment.
    const appraisalId = String(params.id ?? "");
    try {
      await db.transaction(async (tx) => {
        if (!(await markProcessed(tx, msg.messageId))) return;
        switch (op) {
          case "appraisals_feedback_routes__0": {
            const fid = randomUUID();
            await tx.insert(hrms360Feedback).values({
                  id: fid, tenantId: p.tenantId, appraisalId,
                  reviewerId: body.reviewerId, relationship: body.relationship,
                  ratings: body.ratings ?? null, comments: body.comments ?? null,
                  submittedAt: new Date(),
                });
            break;
          }
          case "appraisals_feedback_routes__1": {
            const did = randomUUID();
            await tx.insert(hrmsAparDisclosures).values({
                  id: did, tenantId: p.tenantId, appraisalId, employeeId: body.employeeId,
                });
            break;
          }
          case "appraisals_feedback_routes__2": {
            const aid = randomUUID();
            await tx.insert(hrmsRatingAppeals).values({
                  id: aid, tenantId: p.tenantId, appraisalId,
                  employeeId: body.employeeId, appealReason: body.appealReason,
                  pipLinked: body.pipLinked ?? false, pipPlanId: null,
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
