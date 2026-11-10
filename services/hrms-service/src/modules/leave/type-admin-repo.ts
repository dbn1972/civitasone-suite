/**
 * S8-G3 -- reads/writes behind the leave-type admin routes (deactivate / end allocations /
 * maker-checker requests). Reads take a transaction-like handle so the consumer can run them in
 * its own transaction (nested scopedRead() inside db.transaction() deadlocks the pool -- see
 * employee/repo.ts findByIdTx); routes pass the scopedRead tx.
 */
import { and, eq, sql, desc } from "drizzle-orm";
import type { db } from "../../shared/db.js";
import {
  hrmsLeaveTypes, hrmsLeaveAllocs, hrmsLeaveApps, hrmsLeaveTenantConfig, hrmsLeaveTypeChanges,
  type LeaveTypeChangeRow,
} from "./schema.js";

export type Reader = Pick<typeof db, "select">;
export type Writer = Pick<typeof db, "insert" | "update" | "select">;

export interface LeaveTypeImpact {
  /** Allocations that are still live (status 'active') on this type. */
  activeAllocations: number;
  employeesWithAllocations: number;
  /** Sum of whole-day balances on those allocations -- what ending them forfeits. */
  balanceDaysOnLiveAllocations: number;
  /** Applications that block a deactivation: draft/pending, or approved and not yet over. */
  openApplications: number;
  /** All applications ever filed against the type (history that is preserved). */
  totalApplications: number;
}

export async function findLeaveType(tx: Reader, tenantId: string, id: string) {
  const rows = await tx.select().from(hrmsLeaveTypes)
    .where(and(eq(hrmsLeaveTypes.tenantId, tenantId), eq(hrmsLeaveTypes.id, id))).limit(1);
  return rows[0] ?? null;
}

/** Allocation + application counts for one leave type. `today` = IST date (YYYY-MM-DD). */
export async function leaveTypeImpact(tx: Reader, tenantId: string, leaveTypeId: string, today: string): Promise<LeaveTypeImpact> {
  const [a] = await tx.select({
    n: sql<number>`count(*)::int`,
    emps: sql<number>`count(distinct ${hrmsLeaveAllocs.employeeId})::int`,
    bal: sql<number>`coalesce(sum(${hrmsLeaveAllocs.balanceDays}), 0)::int`,
  }).from(hrmsLeaveAllocs).where(and(
    eq(hrmsLeaveAllocs.tenantId, tenantId), eq(hrmsLeaveAllocs.leaveTypeId, leaveTypeId), eq(hrmsLeaveAllocs.status, "active"),
  ));
  const [p] = await tx.select({
    total: sql<number>`count(*)::int`,
    open: sql<number>`count(*) filter (where ${openAppPredicate(today)})::int`,
  }).from(hrmsLeaveApps).where(and(eq(hrmsLeaveApps.tenantId, tenantId), eq(hrmsLeaveApps.leaveTypeId, leaveTypeId)));
  return {
    activeAllocations: a?.n ?? 0,
    employeesWithAllocations: a?.emps ?? 0,
    balanceDaysOnLiveAllocations: a?.bal ?? 0,
    openApplications: p?.open ?? 0,
    totalApplications: p?.total ?? 0,
  };
}

/** draft/pending, or approved and not yet finished (an approved leave in the past is history, not a blocker). */
function openAppPredicate(today: string) {
  return sql`(${hrmsLeaveApps.status} in ('draft', 'pending') or (${hrmsLeaveApps.status} = 'approved' and ${hrmsLeaveApps.toDate} >= ${today}::date))`;
}

export async function countOpenApplicationsOnAllocation(tx: Reader, tenantId: string, allocId: string, today: string): Promise<number> {
  const [r] = await tx.select({ n: sql<number>`count(*)::int` }).from(hrmsLeaveApps)
    .where(and(eq(hrmsLeaveApps.tenantId, tenantId), eq(hrmsLeaveApps.allocId, allocId), openAppPredicate(today)));
  return r?.n ?? 0;
}

/** Admin list: every type (optionally only active) with its live allocation / open application counts. */
export async function listLeaveTypesWithCounts(tx: Reader, tenantId: string, includeInactive: boolean, today: string) {
  const types = await tx.select().from(hrmsLeaveTypes)
    .where(includeInactive ? eq(hrmsLeaveTypes.tenantId, tenantId) : and(eq(hrmsLeaveTypes.tenantId, tenantId), eq(hrmsLeaveTypes.isActive, true)))
    .orderBy(hrmsLeaveTypes.code);
  const allocCounts = await tx.select({
    leaveTypeId: hrmsLeaveAllocs.leaveTypeId,
    n: sql<number>`count(*)::int`,
  }).from(hrmsLeaveAllocs).where(and(eq(hrmsLeaveAllocs.tenantId, tenantId), eq(hrmsLeaveAllocs.status, "active")))
    .groupBy(hrmsLeaveAllocs.leaveTypeId);
  const appCounts = await tx.select({
    leaveTypeId: hrmsLeaveApps.leaveTypeId,
    total: sql<number>`count(*)::int`,
    open: sql<number>`count(*) filter (where ${openAppPredicate(today)})::int`,
  }).from(hrmsLeaveApps).where(eq(hrmsLeaveApps.tenantId, tenantId)).groupBy(hrmsLeaveApps.leaveTypeId);
  const pending = await tx.select({ id: hrmsLeaveTypeChanges.id, leaveTypeId: hrmsLeaveTypeChanges.leaveTypeId })
    .from(hrmsLeaveTypeChanges).where(and(eq(hrmsLeaveTypeChanges.tenantId, tenantId), eq(hrmsLeaveTypeChanges.status, "pending")));
  const ac = new Map(allocCounts.map((r) => [r.leaveTypeId, r.n]));
  const pc = new Map(appCounts.map((r) => [r.leaveTypeId, r]));
  const pend = new Map(pending.map((r) => [r.leaveTypeId, r.id]));
  return types.map((t) => ({
    ...t,
    activeAllocations: ac.get(t.id) ?? 0,
    openApplications: pc.get(t.id)?.open ?? 0,
    totalApplications: pc.get(t.id)?.total ?? 0,
    pendingChangeId: pend.get(t.id) ?? null,
  }));
}

/** Types nobody has used: no application ever and no live allocation, still active. */
export async function listUnusedLeaveTypes(tx: Reader, tenantId: string) {
  return tx.select({ id: hrmsLeaveTypes.id, code: hrmsLeaveTypes.code, name: hrmsLeaveTypes.name })
    .from(hrmsLeaveTypes).where(and(
      eq(hrmsLeaveTypes.tenantId, tenantId), eq(hrmsLeaveTypes.isActive, true),
      sql`not exists (select 1 from leave.hrms_leave_apps a where a.tenant_id = ${hrmsLeaveTypes.tenantId} and a.leave_type_id = ${hrmsLeaveTypes.id})`,
      sql`not exists (select 1 from leave.hrms_leave_allocs l where l.tenant_id = ${hrmsLeaveTypes.tenantId} and l.leave_type_id = ${hrmsLeaveTypes.id} and l.status = 'active')`,
      sql`not exists (select 1 from leave.hrms_leave_type_changes c where c.tenant_id = ${hrmsLeaveTypes.tenantId} and c.leave_type_id = ${hrmsLeaveTypes.id} and c.status = 'pending')`,
    )).orderBy(hrmsLeaveTypes.code);
}

export async function findChange(tx: Reader, tenantId: string, id: string): Promise<LeaveTypeChangeRow | null> {
  const rows = await tx.select().from(hrmsLeaveTypeChanges)
    .where(and(eq(hrmsLeaveTypeChanges.tenantId, tenantId), eq(hrmsLeaveTypeChanges.id, id))).limit(1);
  return rows[0] ?? null;
}

export async function findPendingChangeForType(tx: Reader, tenantId: string, leaveTypeId: string): Promise<LeaveTypeChangeRow | null> {
  const rows = await tx.select().from(hrmsLeaveTypeChanges).where(and(
    eq(hrmsLeaveTypeChanges.tenantId, tenantId), eq(hrmsLeaveTypeChanges.leaveTypeId, leaveTypeId), eq(hrmsLeaveTypeChanges.status, "pending"),
  )).limit(1);
  return rows[0] ?? null;
}

export async function listChanges(tx: Reader, tenantId: string, status: "pending" | "approved" | "rejected" | "all", limit = 200) {
  const rows = await tx.select({
    id: hrmsLeaveTypeChanges.id, leaveTypeId: hrmsLeaveTypeChanges.leaveTypeId, action: hrmsLeaveTypeChanges.action,
    status: hrmsLeaveTypeChanges.status, reason: hrmsLeaveTypeChanges.reason, impact: hrmsLeaveTypeChanges.impact,
    requestedBy: hrmsLeaveTypeChanges.requestedBy, decidedBy: hrmsLeaveTypeChanges.decidedBy, decidedAt: hrmsLeaveTypeChanges.decidedAt,
    decisionNote: hrmsLeaveTypeChanges.decisionNote, appliedSummary: hrmsLeaveTypeChanges.appliedSummary,
    createdAt: hrmsLeaveTypeChanges.createdAt, leaveTypeCode: hrmsLeaveTypes.code, leaveTypeName: hrmsLeaveTypes.name,
  }).from(hrmsLeaveTypeChanges)
    .leftJoin(hrmsLeaveTypes, and(eq(hrmsLeaveTypes.id, hrmsLeaveTypeChanges.leaveTypeId), eq(hrmsLeaveTypes.tenantId, hrmsLeaveTypeChanges.tenantId)))
    .where(status === "all" ? eq(hrmsLeaveTypeChanges.tenantId, tenantId) : and(eq(hrmsLeaveTypeChanges.tenantId, tenantId), eq(hrmsLeaveTypeChanges.status, status)))
    .orderBy(desc(hrmsLeaveTypeChanges.createdAt)).limit(limit);
  return rows;
}

export async function getCustomLeaveRulesEnabled(tx: Reader, tenantId: string): Promise<boolean> {
  const rows = await tx.select({ on: hrmsLeaveTenantConfig.customLeaveRulesEnabled }).from(hrmsLeaveTenantConfig)
    .where(eq(hrmsLeaveTenantConfig.tenantId, tenantId)).limit(1);
  return rows[0]?.on === true;
}

export async function setCustomLeaveRulesEnabled(tx: Writer, tenantId: string, enabled: boolean, actorId: string): Promise<void> {
  await tx.insert(hrmsLeaveTenantConfig).values({ tenantId, customLeaveRulesEnabled: enabled, createdBy: actorId, updatedBy: actorId })
    .onConflictDoUpdate({
      target: hrmsLeaveTenantConfig.tenantId,
      set: { customLeaveRulesEnabled: enabled, updatedBy: actorId, updatedAt: new Date(), version: sql`${hrmsLeaveTenantConfig.version} + 1` },
    });
}

/** End every live allocation of a type. Returns what was ended (for the audit summary). */
export async function endAllocationsForType(
  tx: Writer, tenantId: string, leaveTypeId: string, today: string, reason: string, actorId: string,
): Promise<{ ended: number; employees: number; balanceDays: number }> {
  const rows = await tx.update(hrmsLeaveAllocs).set({
    status: "ended", endedOn: today, endedReason: reason, endedBy: actorId,
    updatedBy: actorId, updatedAt: new Date(), version: sql`${hrmsLeaveAllocs.version} + 1`,
  }).where(and(
    eq(hrmsLeaveAllocs.tenantId, tenantId), eq(hrmsLeaveAllocs.leaveTypeId, leaveTypeId), eq(hrmsLeaveAllocs.status, "active"),
  )).returning({ employeeId: hrmsLeaveAllocs.employeeId, balanceDays: hrmsLeaveAllocs.balanceDays });
  return {
    ended: rows.length,
    employees: new Set(rows.map((r) => r.employeeId)).size,
    balanceDays: rows.reduce((s, r) => s + r.balanceDays, 0),
  };
}
