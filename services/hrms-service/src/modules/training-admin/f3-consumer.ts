import type { Queue } from "@civitasone/queue";
import { pino } from "pino";
import { and, eq, desc, asc, sql, inArray, isNull, isNotNull, ne, or, gt, lt, gte, lte } from "drizzle-orm";
import { db } from "../../shared/db.js";
import { enqueue, markProcessed } from "../../shared/outbox.js";
import { COMMANDS } from "../../topics.js";
import {
  canApprove, decideApproval, nextWaitlistPosition, pickPromotion, summariseAttendance,
} from "./domain.js";
import * as repo from "./repo.js";
const log = pino({ name: "hrms-f3-training-admin" });
export function registerF3_training_admin_Consumers(queue: Queue): void {
  queue.subscribe(COMMANDS.f3RouteWrite, async (msg) => {
    const p = msg.payload as Record<string, any>;
    const op = String(p.op ?? "");
    const ops = new Set([
      "training_admin_routes__0",
      "training_admin_routes__1",
      "training_admin_routes__2",
      "training_admin_routes__3",
    ]);
    if (!ops.has(op)) return;
    const body = p.body ?? {};
    const params = p.params ?? {};
    const id = (p.id as string) || (params.id as string);
    try {
      await db.transaction(async (tx) => {
        if (!(await markProcessed(tx, msg.messageId))) return;
        switch (op) {
          case "training_admin_routes__0": {
            await repo.insertSession(tx, {
                  id: sid, tenantId: p.tenantId, trainingId: id, title: body.title,
                  sessionDate: body.sessionDate, startTime: body.startTime ?? null, endTime: body.endTime ?? null,
                  venue: body.venue ?? null, capacity: body.capacity, status: "scheduled",
                  createdBy: msg.actorId, updatedBy: msg.actorId,
                });
            break;
          }
          case "training_admin_routes__1": {
            await repo.decideNomination(tx, p.tenantId, id, msg.actorId, {
                  status: outcome, sessionId: body.sessionId, waitlistPosition,
                });
            break;
          }
          case "training_admin_routes__2": {
            const row = await repo.rejectNomination(tx, p.tenantId, id, msg.actorId);
                  if (!row) return null;
                  // If a seat was freed, promote the earliest waitlisted nomination.
                  let promotedId: string | null = null;
                  if (freedApproved && sessionId) {
                    const waitlisted = await repo.listWaitlisted(p.tenantId, sessionId);
                    promotedId = pickPromotion(waitlisted);
                    if (promotedId) await repo.promoteNomination(tx, p.tenantId, promotedId, msg.actorId);
                  }
                  return { row, promotedId };
            break;
          }
          case "training_admin_routes__3": {
            await repo.upsertAttendance(tx, {
                  tenantId: p.tenantId, sessionId: id, employeeId: body.employeeId,
                  status: body.status, markedBy: msg.actorId,
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
