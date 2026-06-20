import type { Queue } from "@civitasone/queue";
import { db } from "../../shared/db.js";
import { cache } from "../../shared/infra.js";
import { enqueue, markProcessed } from "../../shared/outbox.js";
import { COMMANDS, EVENTS } from "../../topics.js";
import * as repo from "./repo.js";
import { assertSufficientLeaveBalance, assertLeaveAppStatusTransition } from "./domain.js";

const AUDIT = "audit.event.record";

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
      await audit(tx, msg, "apply", "leave_app", p.id);
    });
    await cache.invalidate(cache.makeKey(msg.tenantId, "leave_apps_emp", (msg.payload as any).employeeId));
  });

  queue.subscribe(COMMANDS.leaveApprove, async (msg) => {
    const p = msg.payload as { id: string; tenantId: string; approvedBy: string };
    let employeeId = "";
    await db.transaction(async (tx) => {
      if (!(await markProcessed(tx, msg.messageId))) return;
      const app = await repo.findLeaveAppById(p.id, p.tenantId);
      if (!app) throw new Error(`leave app ${p.id} not found`);
      assertLeaveAppStatusTransition(app.status, "approved");
      employeeId = app.employeeId;
      await repo.debitLeaveBalance(tx, app.allocId, app.daysApplied);
      await repo.updateLeaveApp(tx, p.id, { status: "approved", approvedBy: p.approvedBy, updatedBy: msg.actorId });
      await enqueue(tx, {
        topic: EVENTS.leaveApproved, eventType: EVENTS.leaveApproved,
        tenantId: msg.tenantId, actorId: msg.actorId, correlationId: msg.correlationId,
        payload: { leaveAppId: p.id, employeeId: app.employeeId, daysApplied: app.daysApplied },
      });
      await audit(tx, msg, "approve", "leave_app", p.id);
    });
    await cache.invalidate(cache.makeKey(msg.tenantId, "leave_app", p.id));
    if (employeeId) await cache.invalidate(cache.makeKey(msg.tenantId, "leave_apps_emp", employeeId));
  });
}

async function audit(tx: any, msg: any, action: string, resourceType: string, resourceId: string): Promise<void> {
  await enqueue(tx, {
    topic: AUDIT, eventType: AUDIT,
    tenantId: msg.tenantId, actorId: msg.actorId, correlationId: msg.correlationId,
    payload: { service: "hrms", action, resourceType, resourceId, outcome: "success" },
  });
}
