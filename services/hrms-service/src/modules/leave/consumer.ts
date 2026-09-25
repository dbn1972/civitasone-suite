import type { Queue } from "@civitasone/queue";
import { randomUUID } from "node:crypto";
import { NOTIFICATION_SEND, buildNotificationPayload } from "@civitasone/events";
import { db } from "../../shared/db.js";
import { cache } from "../../shared/infra.js";
import { enqueue, markProcessed } from "../../shared/outbox.js";
import { and, eq } from "drizzle-orm";
import { COMMANDS, EVENTS } from "../../topics.js";
import { hrmsLeaveApps, hrmsLeaveAllocs } from "./schema.js";
import * as repo from "./repo.js";
import { assertSufficientLeaveBalance, assertLeaveAppStatusTransition } from "./domain.js";
import { resolveAccumulationCap } from "./rules-engine.js";
import { markLeaveDaysOnAttendance } from "../attendance/leave-sync.js";
import { tenantScoped } from "../../shared/tenant-queue.js";

const AUDIT = "audit.event.record";
const WORKFLOW_CREATE = "workflow.instance.create";
// Emitted by workflow-service's instances consumer when a requested
// definitionCode has no active workflow.definitions row for the tenant
// (its own "R13" fail-closed path: it persists a `rejected` *workflow
// instance*, records history, and emits this -- but never touches the
// domain row that asked for routing in the first place). Subscribed to
// below so a leave application whose routing silently failed doesn't sit
// on a bare "pending" status forever with nothing telling anyone.
const WORKFLOW_INSTANCE_REJECTED = "workflow.instance.rejected";
const LEAVE_WORKFLOW_NAME = "Leave Approval Workflow";

export function registerLeaveConsumers(rawQueue: Queue): void {
  const queue = tenantScoped(rawQueue);
  queue.subscribe(COMMANDS.leaveTypeCreate, async (msg) => {
    const p = msg.payload as {
      id: string; tenantId: string; code: string; name: string; maxDays: number;
      isEncashable: boolean; carryForward: boolean; lopFractionBps: number;
    };
    await db.transaction(async (tx) => {
      if (!(await markProcessed(tx, msg.messageId))) return;
      await repo.insertLeaveType(tx, {
        id: p.id, tenantId: p.tenantId, code: p.code, name: p.name,
        maxDays: p.maxDays, isEncashable: p.isEncashable, carryForward: p.carryForward,
        // HIGH fix (LOP-ignores-leave-type bug): persist the classification
        // validators.ts's createLeaveTypeBody now requires (defaulted to
        // 10000/fully-unpaid when the caller omits it) -- see schema.ts's
        // doc comment on this column.
        lopFractionBps: p.lopFractionBps,
        createdBy: msg.actorId, updatedBy: msg.actorId,
      });
      await audit(tx, msg, "create", "leave_type", p.id);
    });
  });

  queue.subscribe(COMMANDS.leaveAllocate, async (msg) => {
    const p = msg.payload as { id: string; tenantId: string; employeeId: string; leaveTypeId: string; fy: string; totalDays: number; balanceDays: number };
    await db.transaction(async (tx) => {
      if (!(await markProcessed(tx, msg.messageId))) return;
      // DOM-009: the EL (and any carry-forward-eligible) accumulation cap
      // used to only ever produce a WARNING at apply-time, while this — the
      // one place a balance is actually credited — let totalDays/balanceDays
      // grow past it unchecked. Resolve the tenant's admin-configured cap
      // (falling back to the platform default catalog, e.g. EL's 300-day
      // cap) and, if this allocation would exceed it, actually cap the
      // credited amount and record the excess as a lapse.
      const capInputs = await repo.findAccumulationCapInputsTx(tx, p.tenantId, p.employeeId, p.leaveTypeId);
      const cap = resolveAccumulationCap(capInputs.policyRow, capInputs.leaveCode);
      let totalDays = p.totalDays;
      let balanceDays = p.balanceDays;
      let lapsedDays = 0;
      if (cap.carryForward && cap.maxAccumulation > 0 && totalDays > cap.maxAccumulation) {
        lapsedDays = totalDays - cap.maxAccumulation;
        totalDays = cap.maxAccumulation;
        balanceDays = Math.min(balanceDays, cap.maxAccumulation);
      }
      await repo.insertLeaveAlloc(tx, {
        id: p.id, tenantId: p.tenantId, employeeId: p.employeeId,
        leaveTypeId: p.leaveTypeId, fy: p.fy, totalDays, balanceDays,
        createdBy: msg.actorId, updatedBy: msg.actorId,
      });
      await audit(tx, msg, "allocate", "leave_alloc", p.id);
      if (lapsedDays > 0) {
        await enqueue(tx, {
          topic: AUDIT, eventType: AUDIT,
          tenantId: msg.tenantId, actorId: msg.actorId, correlationId: msg.correlationId,
          payload: {
            service: "hrms", action: "lapse", resourceType: "leave_alloc", resourceId: p.id, outcome: "success",
            metadata: {
              employeeId: p.employeeId, leaveTypeId: p.leaveTypeId, fy: p.fy,
              requestedTotalDays: p.totalDays, cappedTotalDays: totalDays,
              maxAccumulation: cap.maxAccumulation, lapsedDays,
            },
          },
        });
      }
    });
  });

  queue.subscribe(COMMANDS.leaveApply, async (msg) => {
    const p = msg.payload as {
      id: string; tenantId: string; employeeId: string; leaveTypeId: string;
      allocId: string; fromDate: string; toDate: string; daysApplied: number; reason?: string;
    };
    await db.transaction(async (tx) => {
      if (!(await markProcessed(tx, msg.messageId))) return;
      const alloc = await repo.findAllocByIdTx(tx, p.allocId);
      if (!alloc) throw new Error(`leave alloc ${p.allocId} not found`);
      assertSufficientLeaveBalance({ totalDays: alloc.totalDays, balanceDays: alloc.balanceDays }, p.daysApplied);
      await repo.insertLeaveApp(tx, {
        id: p.id, tenantId: p.tenantId, employeeId: p.employeeId,
        leaveTypeId: p.leaveTypeId, allocId: p.allocId,
        fromDate: p.fromDate, toDate: p.toDate, daysApplied: p.daysApplied,
        reason: p.reason ?? null, status: "pending",
        createdBy: msg.actorId, updatedBy: msg.actorId,
      });
      await enqueue(tx, {
        topic: EVENTS.leaveApplied, eventType: EVENTS.leaveApplied,
        tenantId: msg.tenantId, actorId: msg.actorId, correlationId: msg.correlationId,
        payload: { leaveAppId: p.id, employeeId: p.employeeId, fromDate: p.fromDate, toDate: p.toDate },
      });
      const wfId = randomUUID();
      await enqueue(tx, {
        topic: WORKFLOW_CREATE, eventType: WORKFLOW_CREATE,
        tenantId: msg.tenantId, actorId: msg.actorId, correlationId: msg.correlationId,
        payload: {
          id: wfId,
          tenantId: msg.tenantId,
          name: `${LEAVE_WORKFLOW_NAME} — ${p.id.slice(0, 8)}`,
          status: "active",
          definitionCode: "leave_approval",
          initialTaskName: "Reporting Officer Approval",
          version: 1,
          refType: "leave_app",
          refId: p.id,
        },
      });
      await audit(tx, msg, "apply", "leave_app", p.id);
    });
    await cache.invalidate(cache.makeKey(msg.tenantId, "leave_apps_emp", (msg.payload as any).employeeId));
  });

  // See WORKFLOW_INSTANCE_REJECTED's own comment above. Guarded to
  // refType === "leave_app": this exact event/topic also fires for every
  // OTHER domain that asks workflow-service to route something (finance/
  // procurement/file_noting/grant_disbursement/recruitment/contracts all
  // publish their own workflow.instance.create), and this handler only
  // knows how to react to leave applications.
  queue.subscribe(WORKFLOW_INSTANCE_REJECTED, async (msg) => {
    const p = msg.payload as {
      instanceId?: string; reason?: string; definitionCode?: string; refType?: string; refId?: string;
    };
    const refId = p.refId;
    if (p.refType !== "leave_app" || !refId) return;
    let notifyEmployeeId = "";
    await db.transaction(async (tx) => {
      if (!(await markProcessed(tx, msg.messageId))) return;
      const app = await repo.findLeaveAppByIdTx(tx, refId, msg.tenantId);
      // Only a still-`pending` application can become routing_failed (see
      // domain.ts's transition map). If HR somehow already actioned it
      // through a different path, or this is a stale/replayed event
      // arriving after the fact, leave the real status alone rather than
      // clobbering a legitimate decision with a stale rejection signal.
      if (!app || app.status !== "pending") return;
      await repo.updateLeaveApp(tx, refId, { status: "routing_failed", updatedBy: msg.actorId });
      notifyEmployeeId = app.employeeId;
      await enqueue(tx, {
        topic: AUDIT, eventType: AUDIT,
        tenantId: msg.tenantId, actorId: msg.actorId, correlationId: msg.correlationId,
        payload: {
          service: "hrms", action: "routing_failed", resourceType: "leave_app", resourceId: refId,
          outcome: "failure",
          metadata: {
            reason: p.reason ?? "unknown", definitionCode: p.definitionCode ?? null,
            workflowInstanceId: p.instanceId ?? null,
          },
        },
      });
      // Proactively tell the applicant -- their own Leave History honestly
      // shows "routing_failed" once this transaction commits (see
      // queries.ts's mapLeaveStatus and the web leave/history page), but a
      // notification means they don't have to go looking for it. Falls
      // back to the system default template like the sibling
      // "hrms.leave.rejected" notification above already does -- no
      // dedicated template is registered for this event type either.
      await enqueue(tx, {
        topic: NOTIFICATION_SEND, eventType: NOTIFICATION_SEND,
        tenantId: msg.tenantId, actorId: msg.actorId, correlationId: msg.correlationId,
        payload: buildNotificationPayload({
          eventType: "hrms.leave.routing_failed",
          recipient: app.employeeId,
          recipientId: app.employeeId,
          variables: { leaveAppId: refId },
        }),
      });
    });
    if (notifyEmployeeId) {
      await cache.invalidate(cache.makeKey(msg.tenantId, "leave_app", refId));
      await cache.invalidate(cache.makeKey(msg.tenantId, "leave_apps_emp", notifyEmployeeId));
    }
  });

  queue.subscribe(COMMANDS.leaveApprove, async (msg) => {
    const p = msg.payload as { id: string; tenantId: string; approvedBy: string };
    let employeeId = "";
    let fromDate = "";
    let toDate = "";
    try {
      await db.transaction(async (tx) => {
        if (!(await markProcessed(tx, msg.messageId))) return;
        const app = await repo.findLeaveAppByIdTx(tx, p.id, p.tenantId);
        if (!app) throw new Error(`leave app ${p.id} not found`);
        assertLeaveAppStatusTransition(app.status, "approved");
        employeeId = app.employeeId;
        fromDate = app.fromDate;
        toDate = app.toDate;
        await repo.debitLeaveBalance(tx, app.allocId, app.daysApplied);
        // H2: race-safe approve — WHERE id = $1 AND status = 'pending' ensures only
        // one concurrent worker succeeds; the other gets rowsAffected = 0 and aborts.
        const rowsAffected = await repo.approveLeaveApp(tx, p.id, { status: "approved", approvedBy: p.approvedBy, updatedBy: msg.actorId });
        if (rowsAffected === 0) throw new Error("LEAVE_ALREADY_PROCESSED");
        await markLeaveDaysOnAttendance(tx, {
          tenantId: p.tenantId,
          employeeId: app.employeeId,
          fromDate: app.fromDate,
          toDate: app.toDate,
          actorId: msg.actorId,
        });
        await enqueue(tx, {
          topic: EVENTS.leaveApproved, eventType: EVENTS.leaveApproved,
          tenantId: msg.tenantId, actorId: msg.actorId, correlationId: msg.correlationId,
          // HIGH fix (LOP-ignores-leave-type bug): leaveTypeId added so
          // payroll-service's integration/consumer.ts can resolve this
          // leave type's paid/unpaid classification (via the new internal
          // .../leave-types/:id/lop-fraction-bps lookup) before deciding how
          // much of daysApplied counts toward Loss-of-Pay -- previously
          // every approved day counted in full, regardless of leave type.
          payload: { leaveAppId: p.id, employeeId: app.employeeId, leaveTypeId: app.leaveTypeId, daysApplied: app.daysApplied, fromDate: app.fromDate, toDate: app.toDate },
        });
        await enqueue(tx, {
          topic: NOTIFICATION_SEND, eventType: NOTIFICATION_SEND,
          tenantId: msg.tenantId, actorId: msg.actorId, correlationId: msg.correlationId,
          payload: buildNotificationPayload({
            eventType: "hrms.leave.approved",
            recipient: app.employeeId,
            recipientId: app.employeeId,
            variables: { leaveAppId: p.id, days: String(app.daysApplied) },
          }),
        });
        await audit(tx, msg, "approve", "leave_app", p.id);
      });
    } catch (err: unknown) {
      if (err instanceof Error && err.message === "LEAVE_ALREADY_PROCESSED") {
        // Idempotent safety: another worker already approved this leave application.
        // Log and return without re-queueing — this is not a bug, just a concurrent duplicate.
        return;
      }
      throw err;
    }
    await cache.invalidate(cache.makeKey(msg.tenantId, "leave_app", p.id));
    if (employeeId) await cache.invalidate(cache.makeKey(msg.tenantId, "leave_apps_emp", employeeId));
  });

  queue.subscribe(COMMANDS.leaveReject, async (msg) => {
    const p = msg.payload as { id: string; tenantId: string; rejectedBy: string; reason: string };
    let employeeId = "";
    await db.transaction(async (tx) => {
      if (!(await markProcessed(tx, msg.messageId))) return;
      const app = await repo.findLeaveAppByIdTx(tx, p.id, p.tenantId);
      if (!app) throw new Error(`leave app ${p.id} not found`);
      assertLeaveAppStatusTransition(app.status, "rejected");
      employeeId = app.employeeId;
      await repo.updateLeaveApp(tx, p.id, { status: "rejected", updatedBy: msg.actorId });
      await enqueue(tx, {
        topic: NOTIFICATION_SEND, eventType: NOTIFICATION_SEND,
        tenantId: msg.tenantId, actorId: msg.actorId, correlationId: msg.correlationId,
        payload: buildNotificationPayload({
          eventType: "hrms.leave.rejected",
          recipient: app.employeeId,
          recipientId: app.employeeId,
          variables: { leaveAppId: p.id, reason: p.reason },
        }),
      });
      await audit(tx, msg, "reject", "leave_app", p.id);
    });
    await cache.invalidate(cache.makeKey(msg.tenantId, "leave_app", p.id));
    if (employeeId) await cache.invalidate(cache.makeKey(msg.tenantId, "leave_apps_emp", employeeId));
  });

  queue.subscribe(COMMANDS.leaveCancel, async (msg) => {
    const p = msg.payload as { id: string; tenantId: string };
    await db.transaction(async (tx) => {
      if (!(await markProcessed(tx, msg.messageId))) return;
      const rows = await tx.select().from(hrmsLeaveApps)
        .where(and(eq(hrmsLeaveApps.id, p.id), eq(hrmsLeaveApps.tenantId, p.tenantId))).limit(1);
      const application = rows[0];
      if (!application) return;
      if (application.status === "cancelled") return;
      const wasApproved = application.status === "approved";
      await tx.update(hrmsLeaveApps)
        .set({ status: "cancelled", updatedAt: new Date(), updatedBy: msg.actorId })
        .where(eq(hrmsLeaveApps.id, p.id));
      if (wasApproved && application.daysApplied > 0) {
        const allocRows = await tx.select().from(hrmsLeaveAllocs)
          .where(eq(hrmsLeaveAllocs.id, application.allocId)).limit(1);
        const alloc = allocRows[0];
        if (alloc) {
          // HIGH fix: this used to be a plain JS read-modify-write
          // (`balanceDays: (alloc.balanceDays ?? 0) + application.daysApplied`)
          // instead of an atomic SQL-expression UPDATE. Two different approved
          // leave applications that share this same allocation can be
          // cancelled concurrently; under the old code both transactions could
          // read the same pre-cancel balanceDays before either committed, so
          // whichever transaction's blind SET landed last would silently
          // clobber the other's credit (a lost update — under-crediting the
          // employee's balance). repo.creditLeaveBalance uses the same
          // `sql`${balanceDays} + ${days}`` atomic-increment pattern already
          // used by debitLeaveBalance/creditLeaveBalance elsewhere in this
          // module's repo.ts (H7 fix) — safe under concurrency because
          // Postgres serializes the two UPDATEs via row-level locking on
          // commit instead of relying on an out-of-transaction JS read.
          await repo.creditLeaveBalance(tx, alloc.id, application.daysApplied);
        }
      }
      await enqueue(tx, {
        topic: "audit.event.record", eventType: "audit.event.record",
        tenantId: msg.tenantId, actorId: msg.actorId, correlationId: msg.correlationId,
        payload: { service: "hrms", action: "cancel", resourceType: "leave_application", resourceId: p.id, outcome: "success" },
      });
      // Notify the original approver that the leave was cancelled
      if (application.approvedBy) {
        await enqueue(tx, {
          topic: NOTIFICATION_SEND, eventType: NOTIFICATION_SEND,
          tenantId: msg.tenantId, actorId: msg.actorId, correlationId: msg.correlationId,
          payload: buildNotificationPayload({
            eventType: "hrms.leave.cancelled",
            recipient: application.approvedBy,
            recipientId: application.approvedBy,
            variables: { leaveAppId: p.id, employeeId: application.employeeId },
          }),
        });
      }
    });
  });
}

async function audit(tx: any, msg: any, action: string, resourceType: string, resourceId: string): Promise<void> {
  await enqueue(tx, {
    topic: AUDIT, eventType: AUDIT,
    tenantId: msg.tenantId, actorId: msg.actorId, correlationId: msg.correlationId,
    payload: { service: "hrms", action, resourceType, resourceId, outcome: "success" },
  });
}
