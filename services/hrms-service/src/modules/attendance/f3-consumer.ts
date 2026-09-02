import { randomUUID } from "node:crypto";
import type { Queue } from "@civitasone/queue";
import { pino } from "pino";
import { and, eq } from "drizzle-orm";
import { db } from "../../shared/db.js";
import { cache } from "../../shared/infra.js";
import { enqueue, markProcessed } from "../../shared/outbox.js";
import { COMMANDS, EVENTS } from "../../topics.js";
import { hrmsOvertimeRequests } from "./schema.js";
import * as repo from "./repo.js";

const log = pino({ name: "hrms-f3-attendance" });

/**
 * F3 leftover fix (batch 2, resweep). routes.ts published five writes
 * (`attendance_routes__0..4`) with no consumer registered at all — the F3
 * code-gen sweep that produced the other hrms consumers never reached this
 * module, so every regularisation approve/reject and overtime create/approve/
 * reject silently no-op'd after the route replied 202.
 *
 * `attendance_routes__0`/`__1` (regularisation approve/reject) restore the
 * atomic `WHERE status='pending'` guarded update + domain-event enqueue +
 * cache invalidation that used to run synchronously in routes.ts
 * (`repo.updateRegularisationStatus`, `EVENTS.regularisationApproved` /
 * `regularisationRejected`, `cache.listKey(tenantId, "attendance_reg",
 * "list:100")`). The route now performs the same existence + status='pending'
 * check itself before publishing (see routes.ts), so reaching this consumer
 * with a stale/already-decided regularisation is only possible under a race;
 * that case is logged and skipped rather than thrown, matching the
 * established leftover-consumer convention for benign races.
 *
 * `attendance_routes__2` (create overtime request) restores the plain insert
 * that used to run synchronously; the route now generates the id upfront so
 * it can reply 202 with it.
 *
 * `attendance_routes__3`/`__4` (overtime approve/reject) restore the
 * conditional update; the route now pre-checks existence itself, so a
 * missing row here (again, only a race) is logged and skipped.
 */
export function registerF3_attendance_Consumers(queue: Queue): void {
  queue.subscribe(COMMANDS.f3RouteWrite, async (msg) => {
    const p = msg.payload as Record<string, any>;
    const op = String(p.op ?? "");
    const ops = new Set([
      "attendance_routes__0",
      "attendance_routes__1",
      "attendance_routes__2",
      "attendance_routes__3",
      "attendance_routes__4",
    ]);
    if (!ops.has(op)) return;
    const body = p.body ?? {};
    const params = p.params ?? {};
    const id = (p.id as string) || (params.id as string);
    let invalidateRegList = false;
    try {
      await db.transaction(async (tx) => {
        if (!(await markProcessed(tx, msg.messageId))) return;
        switch (op) {
          case "attendance_routes__0": {
            const regId = (params.id as string) || id;
            const updated = await repo.updateRegularisationStatus(tx, p.tenantId, regId, "approved", msg.actorId, body.reason);
            if (!updated) {
              log.warn({ op, regId, messageId: msg.messageId }, "regularisation already decided or missing before async approve");
              return;
            }
            await enqueue(tx, {
              topic: EVENTS.regularisationApproved,
              eventType: EVENTS.regularisationApproved,
              tenantId: p.tenantId,
              actorId: msg.actorId,
              correlationId: msg.correlationId,
              payload: {
                regularisationId: regId,
                employeeId: updated.employeeId,
                actorId: msg.actorId,
                attendanceDate: updated.date,
                outcome: "approved",
                timestamp: new Date().toISOString(),
              },
            });
            invalidateRegList = true;
            break;
          }
          case "attendance_routes__1": {
            const regId = (params.id as string) || id;
            const updated = await repo.updateRegularisationStatus(tx, p.tenantId, regId, "rejected", msg.actorId, body.reason);
            if (!updated) {
              log.warn({ op, regId, messageId: msg.messageId }, "regularisation already decided or missing before async reject");
              return;
            }
            await enqueue(tx, {
              topic: EVENTS.regularisationRejected,
              eventType: EVENTS.regularisationRejected,
              tenantId: p.tenantId,
              actorId: msg.actorId,
              correlationId: msg.correlationId,
              payload: {
                regularisationId: regId,
                employeeId: updated.employeeId,
                actorId: msg.actorId,
                attendanceDate: updated.date,
                outcome: "rejected",
                timestamp: new Date().toISOString(),
              },
            });
            invalidateRegList = true;
            break;
          }
          case "attendance_routes__2": {
            await tx.insert(hrmsOvertimeRequests).values({
              id, tenantId: p.tenantId, employeeId: body.employeeId,
              requestDate: body.requestDate, hoursRequested: String(body.hoursRequested),
              reason: body.reason ?? null, createdBy: msg.actorId, updatedBy: msg.actorId,
            });
            break;
          }
          case "attendance_routes__3": {
            const otId = (params.id as string) || id;
            const [updated] = await tx.update(hrmsOvertimeRequests)
              .set({ status: "approved", approvedBy: msg.actorId, approvedAt: new Date(),
                     updatedBy: msg.actorId, updatedAt: new Date() })
              .where(and(eq(hrmsOvertimeRequests.id, otId), eq(hrmsOvertimeRequests.tenantId, p.tenantId)))
              .returning({ id: hrmsOvertimeRequests.id });
            if (!updated) {
              log.warn({ op, otId, messageId: msg.messageId }, "overtime request missing before async approve");
            }
            break;
          }
          case "attendance_routes__4": {
            const otId = (params.id as string) || id;
            const [updated] = await tx.update(hrmsOvertimeRequests)
              .set({ status: "rejected", rejectionReason: body.reason ?? null,
                     updatedBy: msg.actorId, updatedAt: new Date() })
              .where(and(eq(hrmsOvertimeRequests.id, otId), eq(hrmsOvertimeRequests.tenantId, p.tenantId)))
              .returning({ id: hrmsOvertimeRequests.id });
            if (!updated) {
              log.warn({ op, otId, messageId: msg.messageId }, "overtime request missing before async reject");
            }
            break;
          }
        }
      });
      if (invalidateRegList) {
        await cache.invalidate(cache.listKey(p.tenantId, "attendance_reg", "list:100"));
      }
    } catch (err) {
      log.error({ err, op, messageId: msg.messageId }, "f3RouteWrite failed");
      throw err;
    }
  });
}
