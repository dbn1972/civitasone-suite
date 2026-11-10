/**
 * S8-G3 consumers: leave-type update, deactivate (maker-checker), reactivate, single-allocation end,
 * and the per-tenant custom-rules switch. Every handler is idempotent (markProcessed), runs in one
 * transaction with its audit event, and RE-ASSERTS what the route checked (the world can change
 * between publish and consume): checker != maker, request still pending, no open applications.
 */
import { NonRetryableError, type Queue } from "@civitasone/queue";
import { and, eq, sql } from "drizzle-orm";
import { istToday } from "@civitasone/schemas/validators";
import { db } from "../../shared/db.js";
import { enqueue, markProcessed } from "../../shared/outbox.js";
import { tenantScoped } from "../../shared/tenant-queue.js";
import { COMMANDS } from "../../topics.js";
import { hrmsLeaveTypes, hrmsLeaveAllocs, hrmsLeaveTypeChanges } from "./schema.js";
import * as admin from "./type-admin-repo.js";
import type { LeaveTypeChangeRequestPayload, LeaveTypeChangeDecidePayload, LeaveTypeUpdatePayload, AllocEndPayload } from "./type-admin-commands.js";

const AUDIT = "audit.event.record";
type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0];
type Msg = { tenantId: string; actorId: string; correlationId: string; messageId: string };

async function audit(tx: Tx, msg: Msg, action: string, resourceType: string, resourceId: string, outcome: "success" | "denied", metadata: Record<string, unknown>): Promise<void> {
  await enqueue(tx, {
    topic: AUDIT, eventType: AUDIT,
    tenantId: msg.tenantId, actorId: msg.actorId, correlationId: msg.correlationId,
    payload: { service: "hrms", action, resourceType, resourceId, outcome, metadata },
  });
}

export function registerLeaveTypeAdminConsumers(rawQueue: Queue): void {
  const queue = tenantScoped(rawQueue);

  queue.subscribe(COMMANDS.leaveTypeUpdate, async (msg) => {
    const p = msg.payload as LeaveTypeUpdatePayload;
    await db.transaction(async (tx) => {
      if (!(await markProcessed(tx, msg.messageId))) return;
      const before = await admin.findLeaveType(tx, msg.tenantId, p.id);
      if (!before) throw new NonRetryableError(`leave type ${p.id} not found`);
      const set: Record<string, unknown> = {};
      for (const k of ["name", "maxDays", "isEncashable", "carryForward", "lopFractionBps", "systemCode", "category", "genderRestriction", "description"] as const) {
        if (p.changes[k] !== undefined) set[k] = p.changes[k];
      }
      await tx.update(hrmsLeaveTypes).set({ ...set, updatedBy: msg.actorId, updatedAt: new Date(), version: sql`${hrmsLeaveTypes.version} + 1` } as never)
        .where(and(eq(hrmsLeaveTypes.tenantId, msg.tenantId), eq(hrmsLeaveTypes.id, p.id)));
      const prior: Record<string, unknown> = {};
      for (const k of Object.keys(set)) prior[k] = (before as Record<string, unknown>)[k];
      await audit(tx, msg, "update", "leave_type", p.id, "success", { code: before.code, before: prior, after: set });
    });
  });

  // Maker: record the request (impact snapshot for the checker). Nothing is deactivated yet.
  queue.subscribe(COMMANDS.leaveTypeChangeRequest, async (msg) => {
    const p = msg.payload as LeaveTypeChangeRequestPayload;
    await db.transaction(async (tx) => {
      if (!(await markProcessed(tx, msg.messageId))) return;
      await tx.insert(hrmsLeaveTypeChanges).values({
        id: p.id, tenantId: msg.tenantId, leaveTypeId: p.leaveTypeId, action: p.action, status: "pending",
        reason: p.reason, impact: p.impact, requestedBy: msg.actorId, createdBy: msg.actorId, updatedBy: msg.actorId,
        // a concurrent second request for the same type loses on the one-pending partial unique index
      }).onConflictDoNothing();
      await audit(tx, msg, "request_deactivate", "leave_type", p.leaveTypeId, "success", { requestId: p.id, reason: p.reason, impact: p.impact });
    });
  });

  // Checker: approve applies the deactivation + ends live allocations in ONE transaction; reject closes the request.
  queue.subscribe(COMMANDS.leaveTypeChangeDecide, async (msg) => {
    const p = msg.payload as LeaveTypeChangeDecidePayload;
    await db.transaction(async (tx) => {
      if (!(await markProcessed(tx, msg.messageId))) return;
      const req = await admin.findChange(tx, msg.tenantId, p.requestId);
      if (!req) throw new NonRetryableError(`leave type change ${p.requestId} not found`);
      if (req.status !== "pending") return; // already decided (replay / double click): nothing to do
      if (req.requestedBy === msg.actorId) {
        await audit(tx, msg, "decide_deactivate", "leave_type", req.leaveTypeId, "denied", { requestId: req.id, why: "maker-checker: requester cannot decide their own request" });
        throw new NonRetryableError("maker-checker: the requester cannot decide their own request");
      }
      const decidedAt = new Date();
      if (p.decision === "reject") {
        await tx.update(hrmsLeaveTypeChanges).set({ status: "rejected", decidedBy: msg.actorId, decidedAt, decisionNote: p.note ?? null, updatedBy: msg.actorId, updatedAt: decidedAt, version: sql`${hrmsLeaveTypeChanges.version} + 1` })
          .where(and(eq(hrmsLeaveTypeChanges.tenantId, msg.tenantId), eq(hrmsLeaveTypeChanges.id, req.id)));
        await audit(tx, msg, "reject_deactivate", "leave_type", req.leaveTypeId, "success", { requestId: req.id, note: p.note ?? null });
        return;
      }
      const today = istToday();
      const impact = await admin.leaveTypeImpact(tx, msg.tenantId, req.leaveTypeId, today);
      if (impact.openApplications > 0) {
        // Applications were filed after the request: refuse rather than strand them. Closed as rejected, visibly.
        const note = `blocked at approval: ${impact.openApplications} open leave application(s) now exist on this type`;
        await tx.update(hrmsLeaveTypeChanges).set({ status: "rejected", decidedBy: msg.actorId, decidedAt, decisionNote: note, updatedBy: msg.actorId, updatedAt: decidedAt, version: sql`${hrmsLeaveTypeChanges.version} + 1` })
          .where(and(eq(hrmsLeaveTypeChanges.tenantId, msg.tenantId), eq(hrmsLeaveTypeChanges.id, req.id)));
        await audit(tx, msg, "decide_deactivate", "leave_type", req.leaveTypeId, "denied", { requestId: req.id, why: note });
        return;
      }
      await tx.update(hrmsLeaveTypes).set({ isActive: false, updatedBy: msg.actorId, updatedAt: decidedAt, version: sql`${hrmsLeaveTypes.version} + 1` })
        .where(and(eq(hrmsLeaveTypes.tenantId, msg.tenantId), eq(hrmsLeaveTypes.id, req.leaveTypeId)));
      const ended = await admin.endAllocationsForType(tx, msg.tenantId, req.leaveTypeId, today,
        `leave type deactivated (request ${req.id}): ${req.reason}`, msg.actorId);
      const summary = { endedAllocations: ended.ended, employees: ended.employees, balanceDaysForfeited: ended.balanceDays, endedOn: today };
      await tx.update(hrmsLeaveTypeChanges).set({ status: "approved", decidedBy: msg.actorId, decidedAt, decisionNote: p.note ?? null, appliedSummary: summary, updatedBy: msg.actorId, updatedAt: decidedAt, version: sql`${hrmsLeaveTypeChanges.version} + 1` })
        .where(and(eq(hrmsLeaveTypeChanges.tenantId, msg.tenantId), eq(hrmsLeaveTypeChanges.id, req.id)));
      await audit(tx, msg, "deactivate", "leave_type", req.leaveTypeId, "success", {
        requestId: req.id, requestedBy: req.requestedBy, decidedBy: msg.actorId, reason: req.reason, ...summary,
      });
    });
  });

  queue.subscribe(COMMANDS.leaveTypeReactivate, async (msg) => {
    const p = msg.payload as { id: string };
    await db.transaction(async (tx) => {
      if (!(await markProcessed(tx, msg.messageId))) return;
      await tx.update(hrmsLeaveTypes).set({ isActive: true, updatedBy: msg.actorId, updatedAt: new Date(), version: sql`${hrmsLeaveTypes.version} + 1` })
        .where(and(eq(hrmsLeaveTypes.tenantId, msg.tenantId), eq(hrmsLeaveTypes.id, p.id)));
      // Allocations ended by the deactivation stay ended: re-granting is a deliberate, separate allocation.
      await audit(tx, msg, "reactivate", "leave_type", p.id, "success", {});
    });
  });

  queue.subscribe(COMMANDS.leaveAllocEnd, async (msg) => {
    const p = msg.payload as AllocEndPayload;
    await db.transaction(async (tx) => {
      if (!(await markProcessed(tx, msg.messageId))) return;
      const today = istToday();
      if ((await admin.countOpenApplicationsOnAllocation(tx, msg.tenantId, p.id, today)) > 0) {
        await audit(tx, msg, "end", "leave_alloc", p.id, "denied", { why: "open applications exist on this allocation" });
        throw new NonRetryableError("allocation has open leave applications");
      }
      const rows = await tx.update(hrmsLeaveAllocs).set({
        status: "ended", endedOn: today, endedReason: p.reason, endedBy: msg.actorId,
        updatedBy: msg.actorId, updatedAt: new Date(), version: sql`${hrmsLeaveAllocs.version} + 1`,
      }).where(and(eq(hrmsLeaveAllocs.tenantId, msg.tenantId), eq(hrmsLeaveAllocs.id, p.id), eq(hrmsLeaveAllocs.status, "active")))
        .returning({ employeeId: hrmsLeaveAllocs.employeeId, leaveTypeId: hrmsLeaveAllocs.leaveTypeId, balanceDays: hrmsLeaveAllocs.balanceDays });
      if (rows.length === 0) return; // already ended
      await audit(tx, msg, "end", "leave_alloc", p.id, "success", { ...rows[0], reason: p.reason, endedOn: today });
    });
  });

  queue.subscribe(COMMANDS.leaveCustomRulesSet, async (msg) => {
    const p = msg.payload as { enabled: boolean };
    await db.transaction(async (tx) => {
      if (!(await markProcessed(tx, msg.messageId))) return;
      await admin.setCustomLeaveRulesEnabled(tx, msg.tenantId, p.enabled, msg.actorId);
      await audit(tx, msg, "update", "leave_custom_rules_switch", msg.tenantId, "success", { enabled: p.enabled });
    });
  });
}
