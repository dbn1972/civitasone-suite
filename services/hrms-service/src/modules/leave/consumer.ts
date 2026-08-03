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
import { markLeaveDaysOnAttendance } from "../attendance/leave-sync.js";

const AUDIT = "audit.event.record";
const WORKFLOW_CREATE = "workflow.instance.create";
const LEAVE_WORKFLOW_NAME = "Leave Approval Workflow";

export function registerLeaveConsumers(queue: Queue): void {
  queue.subscribe(COMMANDS.leaveTypeCreate, async (msg) => {
    const p = msg.payload as { id: string; tenantId: string; code: string; name: string; maxDays: number; isEncashable: boolean; carryForward: boolean };
    await db.transaction(async (tx) => {
      if (!(await markProcessed(tx, msg.messageId))) return;
      await repo.insertLeaveType(tx, {
        id: p.id, tenantId: p.tenantId, code: p.code, name: p.name,
        maxDays: p.maxDays, isEncashable: p.isEncashable, carryForward: p.carryForward,
        createdBy: msg.actorId, updatedBy: msg.actorId,
      });
      await audit(tx, msg, "create", "leave_type", p.id);
    });
  });

  queue.subscribe(COMMANDS.leaveAllocate, async (msg) => {
    const p = msg.payload as { id: string; tenantId: string; employeeId: string; leaveTypeId: string; fy: string; totalDays: number; balanceDays: number };
    await db.transaction(async (tx) => {
      if (!(await markProcessed(tx, msg.messageId))) return;
      await repo.insertLeaveAlloc(tx, {
        id: p.id, tenantId: p.tenantId, employeeId: p.employeeId,
        leaveTypeId: p.leaveTypeId, fy: p.fy, totalDays: p.totalDays, balanceDays: p.totalDays,
        createdBy: msg.actorId, updatedBy: msg.actorId,
      });
      await audit(tx, msg, "allocate", "leave_alloc", p.id);
    });
  });

  queue.subscribe(COMMANDS.leaveApply, async (msg) => {
    const p = msg.payload as {
      id: string; tenantId: string; employeeId: string; leaveTypeId: string;
      allocId: string; fromDate: string; toDate: string; daysApplied: number; reason?: string;
    };
    await db.transaction(async (tx) => {
      if (!(await markProcessed(tx, msg.messageId))) return;
      const alloc = await repo.findAllocById(p.allocId);
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

  queue.subscribe(COMMANDS.leaveApprove, async (msg) => {
    const p = msg.payload as { id: string; tenantId: string; approvedBy: string };
    let employeeId = "";
    let fromDate = "";
    let toDate = "";
    await db.transaction(async (tx) => {
      if (!(await markProcessed(tx, msg.messageId))) return;
      const app = await repo.findLeaveAppById(p.id, p.tenantId);
      if (!app) throw new Error(`leave app ${p.id} not found`);
      assertLeaveAppStatusTransition(app.status, "approved");
      employeeId = app.employeeId;
      fromDate = app.fromDate;
      toDate = app.toDate;
      await repo.debitLeaveBalance(tx, app.allocId, app.daysApplied);
      await repo.updateLeaveApp(tx, p.id, { status: "approved", approvedBy: p.approvedBy, updatedBy: msg.actorId });
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
        payload: { leaveAppId: p.id, employeeId: app.employeeId, daysApplied: app.daysApplied, fromDate: app.fromDate, toDate: app.toDate },
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
    await cache.invalidate(cache.makeKey(msg.tenantId, "leave_app", p.id));
    if (employeeId) await cache.invalidate(cache.makeKey(msg.tenantId, "leave_apps_emp", employeeId));
  });

  queue.subscribe(COMMANDS.leaveReject, async (msg) => {
    const p = msg.payload as { id: string; tenantId: string; rejectedBy: string; reason: string };
    let employeeId = "";
    await db.transaction(async (tx) => {
      if (!(await markProcessed(tx, msg.messageId))) return;
      const app = await repo.findLeaveAppById(p.id, p.tenantId);
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
          await tx.update(hrmsLeaveAllocs)
            .set({ balanceDays: (alloc.balanceDays ?? 0) + application.daysApplied, updatedAt: new Date() })
            .where(eq(hrmsLeaveAllocs.id, alloc.id));
        }
      }
      await enqueue(tx, {
        topic: "audit.event.record", eventType: "audit.event.record",
        tenantId: msg.tenantId, actorId: msg.actorId, correlationId: msg.correlationId,
        payload: { service: "hrms", action: "cancel", resourceType: "leave_application", resourceId: p.id, outcome: "success" },
      });
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
