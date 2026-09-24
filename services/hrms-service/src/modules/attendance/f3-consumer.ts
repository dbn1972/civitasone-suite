import { randomUUID } from "node:crypto";
import type { Queue } from "@civitasone/queue";
import { pino } from "pino";
import { and, eq } from "drizzle-orm";
import { db } from "../../shared/db.js";
import { cache } from "../../shared/infra.js";
import { enqueue, markProcessed } from "../../shared/outbox.js";
import { COMMANDS, EVENTS } from "../../topics.js";
import { hrmsOvertimeRequests, hrmsWfhRequests, hrmsShiftChangeRequests } from "./schema.js";
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
 * Bug fix: `attendance_routes__0` (approve) used to stop at flipping this
 * request's own status — it never actually applied the correction to
 * hrms_attendance, so an approved regularisation left the employee's
 * attendance record for that date completely unchanged (e.g. still
 * "absent"). It now also upserts hrms_attendance with the regularisation's
 * requestedStatus. No consumer anywhere subscribes to the
 * EVENTS.regularisationApproved event this case already enqueues (confirmed
 * by inspection — grep the whole hrms-service tree for it), so that event
 * was never actually closing this loop either.
 *
 * `attendance_routes__2` (create overtime request) restores the plain insert
 * that used to run synchronously; the route now generates the id upfront so
 * it can reply 202 with it.
 *
 * `attendance_routes__3`/`__4` (overtime approve/reject) restore the
 * conditional update; the route now pre-checks existence AND status itself
 * (status-integrity fix — see routes.ts and repo.updateOvertimeStatus), so a
 * missing-or-already-decided row here (again, only a race) is logged and
 * skipped rather than thrown.
 *
 * WAVE-4 gap closure: `attendance_routes__5`/`__6`/`__7` (WFH create/approve/
 * reject) and `__8`/`__9`/`__10` (shift-change create/approve/reject) follow
 * the exact same shape as `__2`/`__3`/`__4` above (plain insert on create;
 * conditional update on approve/reject). Like `__3`/`__4` after the status-
 * integrity fix above, the approve/reject updates here carry a
 * `status = 'pending'` guard in their WHERE clause -- routes.ts already
 * re-checks status==='pending' synchronously before publishing, so this is
 * defense in depth against the same race the regularisation consumer above
 * guards against with its own WHERE clause; a guard miss here is therefore
 * only ever a race and is logged and skipped, same convention as every other
 * case in this file.
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
      "attendance_routes__5",
      "attendance_routes__6",
      "attendance_routes__7",
      "attendance_routes__8",
      "attendance_routes__9",
      "attendance_routes__10",
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
            // Bug fix: approving a regularisation previously only flipped
            // this request's own status — it never touched hrms_attendance,
            // so the employee's attendance record for the date kept
            // whatever it was before (e.g. still "absent") regardless of
            // what correction was approved. upsertAttendance both corrects
            // an existing row and creates one if none existed yet for the
            // date (e.g. the employee never punched in at all, which is
            // itself a common reason to file a regularisation — so this
            // deliberately does NOT require a pre-existing attendance row).
            await repo.upsertAttendance(tx, {
              id: randomUUID(),
              tenantId: p.tenantId,
              employeeId: updated.employeeId,
              attendanceDate: updated.date,
              status: updated.requestedStatus,
              source: "regularisation",
              createdBy: msg.actorId,
              updatedBy: msg.actorId,
            });
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
            // Status-guard fix: this used to be a blind UPDATE keyed only on
            // id+tenantId, so an already-decided request (approved or
            // rejected) could be silently re-approved with no error --
            // illegal state reversal. repo.updateOvertimeStatus adds the
            // same WHERE status='pending' guard used by
            // updateRegularisationStatus above; the route now also
            // pre-checks status itself (see routes.ts), so a null result
            // here is only reachable under a race and is logged and skipped
            // rather than thrown, matching that established convention.
            const updated = await repo.updateOvertimeStatus(tx, p.tenantId, otId, "approved", msg.actorId);
            if (!updated) {
              log.warn({ op, otId, messageId: msg.messageId }, "overtime request missing or already decided before async approve");
            }
            break;
          }
          case "attendance_routes__4": {
            const otId = (params.id as string) || id;
            // Status-guard fix — same reasoning as attendance_routes__3 above.
            const updated = await repo.updateOvertimeStatus(tx, p.tenantId, otId, "rejected", msg.actorId, body.reason ?? null);
            if (!updated) {
              log.warn({ op, otId, messageId: msg.messageId }, "overtime request missing or already decided before async reject");
            }
            break;
          }
          case "attendance_routes__5": {
            await tx.insert(hrmsWfhRequests).values({
              id, tenantId: p.tenantId, employeeId: body.employeeId,
              fromDate: body.fromDate, toDate: body.toDate,
              reason: body.reason ?? null, createdBy: msg.actorId, updatedBy: msg.actorId,
            });
            break;
          }
          case "attendance_routes__6": {
            const reqId = (params.id as string) || id;
            // status='pending' guard: routes.ts already re-checks this
            // synchronously before publishing, so a miss here is only ever a
            // race (concurrent decide) -- log and skip, same convention as
            // the regularisation cases above, not overtime's unguarded
            // update.
            const [updated] = await tx.update(hrmsWfhRequests)
              .set({ status: "approved", approvedBy: msg.actorId, approvedAt: new Date(),
                     updatedBy: msg.actorId, updatedAt: new Date() })
              .where(and(
                eq(hrmsWfhRequests.id, reqId), eq(hrmsWfhRequests.tenantId, p.tenantId),
                eq(hrmsWfhRequests.status, "pending"),
              ))
              .returning({ id: hrmsWfhRequests.id });
            if (!updated) {
              log.warn({ op, reqId, messageId: msg.messageId }, "WFH request already decided or missing before async approve");
            }
            break;
          }
          case "attendance_routes__7": {
            const reqId = (params.id as string) || id;
            const [updated] = await tx.update(hrmsWfhRequests)
              .set({ status: "rejected", rejectionReason: body.reason ?? null,
                     updatedBy: msg.actorId, updatedAt: new Date() })
              .where(and(
                eq(hrmsWfhRequests.id, reqId), eq(hrmsWfhRequests.tenantId, p.tenantId),
                eq(hrmsWfhRequests.status, "pending"),
              ))
              .returning({ id: hrmsWfhRequests.id });
            if (!updated) {
              log.warn({ op, reqId, messageId: msg.messageId }, "WFH request already decided or missing before async reject");
            }
            break;
          }
          case "attendance_routes__8": {
            await tx.insert(hrmsShiftChangeRequests).values({
              id, tenantId: p.tenantId, employeeId: body.employeeId,
              currentShift: body.currentShift, requestedShift: body.requestedShift,
              effectiveDate: body.effectiveDate,
              reason: body.reason ?? null, createdBy: msg.actorId, updatedBy: msg.actorId,
            });
            break;
          }
          case "attendance_routes__9": {
            const reqId = (params.id as string) || id;
            const [updated] = await tx.update(hrmsShiftChangeRequests)
              .set({ status: "approved", approvedBy: msg.actorId, approvedAt: new Date(),
                     updatedBy: msg.actorId, updatedAt: new Date() })
              .where(and(
                eq(hrmsShiftChangeRequests.id, reqId), eq(hrmsShiftChangeRequests.tenantId, p.tenantId),
                eq(hrmsShiftChangeRequests.status, "pending"),
              ))
              .returning({ id: hrmsShiftChangeRequests.id });
            if (!updated) {
              log.warn({ op, reqId, messageId: msg.messageId }, "shift-change request already decided or missing before async approve");
            }
            break;
          }
          case "attendance_routes__10": {
            const reqId = (params.id as string) || id;
            const [updated] = await tx.update(hrmsShiftChangeRequests)
              .set({ status: "rejected", rejectionReason: body.reason ?? null,
                     updatedBy: msg.actorId, updatedAt: new Date() })
              .where(and(
                eq(hrmsShiftChangeRequests.id, reqId), eq(hrmsShiftChangeRequests.tenantId, p.tenantId),
                eq(hrmsShiftChangeRequests.status, "pending"),
              ))
              .returning({ id: hrmsShiftChangeRequests.id });
            if (!updated) {
              log.warn({ op, reqId, messageId: msg.messageId }, "shift-change request already decided or missing before async reject");
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
