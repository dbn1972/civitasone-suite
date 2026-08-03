// @ts-nocheck — generated F3 leftover consumer; locals closed over from route txs
import type { Queue } from "@civitasone/queue";
import { pino } from "pino";
import { and, eq, desc, asc, sql, inArray, isNull, isNotNull, ne, or, gt, lt, gte, lte } from "drizzle-orm";
import { db } from "../../shared/db.js";
import { enqueue, markProcessed } from "../../shared/outbox.js";
import { COMMANDS } from "../../topics.js";
import { hrms360Feedback, hrmsAparDisclosures, hrmsRatingAppeals } from "./schema.js";
const log = pino({ name: "hrms-f3-appraisals" });
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
    try {
      await db.transaction(async (tx) => {
        if (!(await markProcessed(tx, msg.messageId))) return;
        switch (op) {
          case "appraisals_feedback_routes__0": {
            await tx.insert(hrms360Feedback).values({
                  id: fid, tenantId: p.tenantId, appraisalId: id,
                  reviewerId: body.reviewerId, relationship: body.relationship,
                  ratings: body.ratings ?? null, comments: body.comments ?? null,
                  submittedAt: new Date(),
                });
            break;
          }
          case "appraisals_feedback_routes__1": {
            await tx.insert(hrmsAparDisclosures).values({
                  id: did, tenantId: p.tenantId, appraisalId: id, employeeId: body.employeeId,
                });
            break;
          }
          case "appraisals_feedback_routes__2": {
            await tx.insert(hrmsRatingAppeals).values({
                  id: aid, tenantId: p.tenantId, appraisalId: id,
                  employeeId: body.employeeId, appealReason: body.appealReason,
                  pipLinked: body.pipLinked, pipPlanId: null,
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
