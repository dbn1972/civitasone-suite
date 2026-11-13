/**
 * S8-G3 consumers: leave-type update, deactivate (maker-checker), reactivate, single-allocation end,
 * and the per-tenant custom-rules switch. Every handler is idempotent (markProcessed), runs in one
 * transaction with its audit event, and RE-ASSERTS what the route checked (the world can change
 * between publish and consume): checker != maker, request still pending, no open applications.
 */
import { NonRetryableError, type Queue } from "@civitasone/queue";
import { and, eq, sql } from "drizzle-orm";
import { effectiveBalanceDays } from "./domain.js";
import { istToday } from "@civitasone/schemas/validators";
import { db } from "../../shared/db.js";
import { enqueue, markProcessed } from "../../shared/outbox.js";
import { tenantScoped } from "../../shared/tenant-queue.js";
import { COMMANDS } from "../../topics.js";
import { hrmsLeaveTypes, hrmsLeaveAllocs, hrmsLeaveTypeChanges } from "./schema.js";
import * as admin from "./type-admin-repo.js";
import type { LeaveTypeChangeRequestPayload, LeaveTypeChangeDecidePayload, LeaveTypeUpdatePayload } from "./type-admin-commands.js";

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

  // Maker: record the request (impact snapshot for the checker). Nothing is changed yet.
  queue.subscribe(COMMANDS.leaveTypeChangeRequest, async (msg) => {
    const p = msg.payload as LeaveTypeChangeRequestPayload;
    await db.transaction(async (tx) => {
      if (!(await markProcessed(tx, msg.messageId))) return;
      const inserted = await tx.insert(hrmsLeaveTypeChanges).values({
        id: p.id, tenantId: msg.tenantId, leaveTypeId: p.leaveTypeId, allocId: p.allocId ?? null, action: p.action, status: "pending",
        reason: p.reason, impact: p.impact, requestedBy: msg.actorId, createdBy: msg.actorId, updatedBy: msg.actorId,
        // a concurrent second request for the same target loses on the one-pending partial unique index
      }).onConflictDoNothing().returning({ id: hrmsLeaveTypeChanges.id });
      if (inserted.length === 0) return; // dropped by the unique index: no request exists, so no audit claims one
      await audit(tx, msg, `request_${p.action}`, p.allocId ? "leave_alloc" : "leave_type", p.allocId ?? p.leaveTypeId, "success",
        { requestId: p.id, leaveTypeId: p.leaveTypeId, reason: p.reason, impact: p.impact });
    });
  });

  // Checker: approve applies the change in ONE transaction; reject closes the request. The request row is
  // locked FOR UPDATE so two concurrent decisions serialise (the loser sees it already decided and no-ops).
  // Refusals (maker == checker, blocked by newly open applications) are COMMITTED with a "denied" audit and
  // returned, never thrown: a throw would roll the audit back with the transaction.
  queue.subscribe(COMMANDS.leaveTypeChangeDecide, async (msg) => {
    const p = msg.payload as LeaveTypeChangeDecidePayload;
    await db.transaction(async (tx) => {
      if (!(await markProcessed(tx, msg.messageId))) return;
      const req = await admin.findChange(tx, msg.tenantId, p.requestId, true);
      if (!req || req.status !== "pending") return; // unknown, or already decided (replay / double click)
      const target = req.allocId ?? req.leaveTypeId;
      const resourceType = req.allocId ? "leave_alloc" : "leave_type";
      if (req.requestedBy === msg.actorId) {
        await audit(tx, msg, `decide_${req.action}`, resourceType, target, "denied", { requestId: req.id, why: "maker-checker: requester cannot decide their own request" });
        return;
      }
      const decidedAt = new Date();
      const close = async (status: "approved" | "rejected", note: string | null, applied?: Record<string, unknown>) => {
        await tx.update(hrmsLeaveTypeChanges).set({
          status, decidedBy: msg.actorId, decidedAt, decisionNote: note, ...(applied ? { appliedSummary: applied } : {}),
          updatedBy: msg.actorId, updatedAt: decidedAt, version: sql`${hrmsLeaveTypeChanges.version} + 1`,
        }).where(and(eq(hrmsLeaveTypeChanges.tenantId, msg.tenantId), eq(hrmsLeaveTypeChanges.id, req.id)));
      };
      const refuse = async (note: string) => {
        await close("rejected", note);
        await audit(tx, msg, `decide_${req.action}`, resourceType, target, "denied", { requestId: req.id, why: note });
      };
      if (p.decision === "reject") {
        await close("rejected", p.note ?? null);
        await audit(tx, msg, `reject_${req.action}`, resourceType, target, "success", { requestId: req.id, note: p.note ?? null });
        return;
      }
      const today = istToday();
      if (req.action === "deactivate") {
        const impact = await admin.leaveTypeImpact(tx, msg.tenantId, req.leaveTypeId, today);
        if (impact.openApplications > 0) return refuse(`blocked at approval: ${impact.openApplications} open leave application(s) now exist on this type`);
        await tx.update(hrmsLeaveTypes).set({ isActive: false, updatedBy: msg.actorId, updatedAt: decidedAt, version: sql`${hrmsLeaveTypes.version} + 1` })
          .where(and(eq(hrmsLeaveTypes.tenantId, msg.tenantId), eq(hrmsLeaveTypes.id, req.leaveTypeId)));
        const ended = await admin.endAllocationsForType(tx, msg.tenantId, req.leaveTypeId, today,
          `leave type deactivated (request ${req.id}): ${req.reason}`, msg.actorId);
        const summary = { endedAllocations: ended.ended, employees: ended.employees, balanceDaysForfeited: ended.balanceDays, endedOn: today };
        await close("approved", p.note ?? null, summary);
        await audit(tx, msg, "deactivate", "leave_type", req.leaveTypeId, "success", {
          requestId: req.id, requestedBy: req.requestedBy, decidedBy: msg.actorId, reason: req.reason, ...summary,
        });
        return;
      }
      const alloc = req.allocId ? await admin.findAllocation(tx, msg.tenantId, req.allocId) : null;
      if (!alloc) return refuse("the allocation no longer exists");
      if (req.action === "end_allocation") {
        if (alloc.status !== "active") return refuse("the allocation is already ended");
        if ((await admin.countOpenApplicationsOnAllocation(tx, msg.tenantId, alloc.id, today)) > 0) {
          return refuse("blocked at approval: open leave applications now draw on this allocation");
        }
        const balance = effectiveBalanceDays(alloc);
        await tx.update(hrmsLeaveAllocs).set({
          status: "ended", endedOn: today, endedReason: `allocation ended (request ${req.id}): ${req.reason}`, endedBy: msg.actorId,
          updatedBy: msg.actorId, updatedAt: decidedAt, version: sql`${hrmsLeaveAllocs.version} + 1`,
        }).where(and(eq(hrmsLeaveAllocs.tenantId, msg.tenantId), eq(hrmsLeaveAllocs.id, alloc.id)));
        const summary = { employeeId: alloc.employeeId, leaveTypeId: alloc.leaveTypeId, fy: alloc.fy, balanceDaysForfeited: balance, endedOn: today };
        await close("approved", p.note ?? null, summary);
        await audit(tx, msg, "end", "leave_alloc", alloc.id, "success", { requestId: req.id, requestedBy: req.requestedBy, decidedBy: msg.actorId, reason: req.reason, ...summary });
        return;
      }
      // reinstate_allocation: the balance on the ended row is exactly what it was when it was ended
      // (the debit path refuses ended rows), so flipping the status restores it as it was.
      if (alloc.status !== "ended") return refuse("the allocation is not ended");
      const lt = await admin.findLeaveType(tx, msg.tenantId, alloc.leaveTypeId);
      if (!lt || lt.isActive === false) return refuse("the leave type is deactivated; reactivate it first");
      await tx.update(hrmsLeaveAllocs).set({
        status: "active", endedOn: null, endedReason: null, endedBy: null,
        updatedBy: msg.actorId, updatedAt: decidedAt, version: sql`${hrmsLeaveAllocs.version} + 1`,
      }).where(and(eq(hrmsLeaveAllocs.tenantId, msg.tenantId), eq(hrmsLeaveAllocs.id, alloc.id)));
      const restored = effectiveBalanceDays(alloc);
      const summary = { employeeId: alloc.employeeId, leaveTypeId: alloc.leaveTypeId, fy: alloc.fy, balanceDaysRestored: restored };
      await close("approved", p.note ?? null, summary);
      await audit(tx, msg, "reinstate", "leave_alloc", alloc.id, "success", { requestId: req.id, requestedBy: req.requestedBy, decidedBy: msg.actorId, reason: req.reason, ...summary });
    });
  });

  queue.subscribe(COMMANDS.leaveTypeReactivate, async (msg) => {
    const p = msg.payload as { id: string };
    await db.transaction(async (tx) => {
      if (!(await markProcessed(tx, msg.messageId))) return;
      await tx.update(hrmsLeaveTypes).set({ isActive: true, updatedBy: msg.actorId, updatedAt: new Date(), version: sql`${hrmsLeaveTypes.version} + 1` })
        .where(and(eq(hrmsLeaveTypes.tenantId, msg.tenantId), eq(hrmsLeaveTypes.id, p.id)));
      // Allocations ended by the deactivation stay ended; each is brought back only by its own reinstate request (maker-checker).
      await audit(tx, msg, "reactivate", "leave_type", p.id, "success", {});
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
