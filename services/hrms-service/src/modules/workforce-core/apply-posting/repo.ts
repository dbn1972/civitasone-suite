/**
 * applyPosting — guarded writes (SmartTransfer OS, ST-M01-09).
 *
 * The ONE place a posting actually changes (D-ST-09, D-ST-10 APPROVED; D-ST-10
 * requires that SmartTransfer only ever moves a posting through this command,
 * never a direct HRMS/Workforce-Core table write). Every function here takes
 * the caller's open transaction (`Writer`) so the whole apply — close previous
 * occupancy, open the new one, append the ledger, update the employee master,
 * append a service-book entry — commits or rolls back atomically with the
 * consumer's `markProcessed` + `audit.event.record` (house rule 1).
 *
 * Spec §4 (universal domain model: Sanctioned Position, Occupancy, Posting
 * History / Service Tenure). No cross-service FK: post/office/employee are
 * referenced by id only (CLAUDE.md §3.13).
 */
import { and, eq, isNull, sql } from "drizzle-orm";
import type { db } from "../../../shared/db.js";
import { wcPost, wcPostOccupancy, wcPostingLedger } from "../schema.js";
import { hrmsEmployees } from "../../employee/schema.js";
import { hrmsServiceBookEntries } from "../../service-book/schema.js";

export type Writer = Pick<typeof db, "insert" | "update" | "select">;

/** The post an order moves an employee into, as read inside the apply tx. */
export interface PostRow {
  id: string;
  officeId: string;
  designationId: string | null;
  cadreId: string | null;
}

/**
 * Load the target post inside the transaction. RLS scopes it to the tenant, so
 * a post belonging to another tenant (or a non-existent id) returns undefined
 * and the caller refuses the apply — never a cross-tenant read.
 */
export async function findPost(
  tx: Writer,
  postId: string,
): Promise<PostRow | undefined> {
  const rows = await (tx as typeof db)
    .select({
      id: wcPost.id,
      officeId: wcPost.officeId,
      designationId: wcPost.designationId,
      cadreId: wcPost.cadreId,
    })
    .from(wcPost)
    .where(eq(wcPost.id, postId))
    .limit(1);
  return rows[0];
}

/** The employee's current (open) SUBSTANTIVE occupancy row, if any. */
export interface OpenOccupancy {
  id: string;
  postId: string;
  effectiveFrom: string;
}

/**
 * The employee's current OPEN (effective_to IS NULL) substantive occupancy.
 * There is at most one by the EXCLUDE constraint; we read it so we can close it
 * the day before the new posting takes effect.
 */
export async function findOpenOccupancyForEmployee(
  tx: Writer,
  employeeId: string,
): Promise<OpenOccupancy | undefined> {
  const rows = await (tx as typeof db)
    .select({
      id: wcPostOccupancy.id,
      postId: wcPostOccupancy.postId,
      effectiveFrom: wcPostOccupancy.effectiveFrom,
    })
    .from(wcPostOccupancy)
    .where(
      and(
        eq(wcPostOccupancy.employeeId, employeeId),
        eq(wcPostOccupancy.chargeType, "substantive"),
        isNull(wcPostOccupancy.effectiveTo),
      ),
    )
    .limit(1);
  return rows[0];
}

/**
 * Close an open occupancy span by setting its effective_to. Guarded: only an
 * OPEN (effective_to IS NULL) row is closed, so a redelivery that already
 * closed it is a no-op. Returns the number of rows closed.
 */
export async function closeOccupancy(
  tx: Writer,
  occupancyId: string,
  effectiveTo: string,
  actorId: string,
): Promise<number> {
  const rows = await (tx as typeof db)
    .update(wcPostOccupancy)
    .set({
      effectiveTo,
      updatedBy: actorId,
      updatedAt: new Date(),
      version: sql`${wcPostOccupancy.version} + 1`,
    })
    .where(
      and(
        eq(wcPostOccupancy.id, occupancyId),
        isNull(wcPostOccupancy.effectiveTo),
      ),
    )
    .returning({ id: wcPostOccupancy.id });
  return rows.length;
}

/** Close the open ledger span for an employee (same guard shape as occupancy). */
export async function closeOpenLedgerSpan(
  tx: Writer,
  employeeId: string,
  effectiveTo: string,
): Promise<void> {
  // The posting_ledger append-only trigger permits exactly this: NULL -> date
  // on an otherwise unchanged row (version bump allowed).
  await (tx as typeof db)
    .update(wcPostingLedger)
    .set({ effectiveTo, version: sql`${wcPostingLedger.version} + 1` })
    .where(
      and(
        eq(wcPostingLedger.employeeId, employeeId),
        eq(wcPostingLedger.chargeType, "substantive"),
        isNull(wcPostingLedger.effectiveTo),
      ),
    );
}

/** The employee's open substantive ledger span's start date, if any. */
export async function findOpenLedgerSpanStart(
  tx: Writer,
  employeeId: string,
): Promise<string | undefined> {
  const rows = await (tx as typeof db)
    .select({ effectiveFrom: wcPostingLedger.effectiveFrom })
    .from(wcPostingLedger)
    .where(
      and(
        eq(wcPostingLedger.employeeId, employeeId),
        eq(wcPostingLedger.chargeType, "substantive"),
        isNull(wcPostingLedger.effectiveTo),
      ),
    )
    .limit(1);
  return rows[0]?.effectiveFrom;
}

export interface OpenPosting {
  tenantId: string;
  employeeId: string;
  postId: string;
  officeId: string;
  chargeType: string;
  effectiveFrom: string;
  orderRef: string;
  actorId: string;
}

/** Open a new substantive occupancy span. Throws (EXCLUDE) on a genuine clash. */
export async function openOccupancy(
  tx: Writer,
  p: OpenPosting,
): Promise<string> {
  const rows = await (tx as typeof db)
    .insert(wcPostOccupancy)
    .values({
      tenantId: p.tenantId,
      postId: p.postId,
      employeeId: p.employeeId,
      chargeType: p.chargeType,
      effectiveFrom: p.effectiveFrom,
      effectiveTo: null,
      orderRef: p.orderRef,
      createdBy: p.actorId,
      updatedBy: p.actorId,
    })
    .returning({ id: wcPostOccupancy.id });
  return rows[0]!.id;
}

/** Append a posting-ledger row (append-only history). */
export async function appendLedger(
  tx: Writer,
  p: OpenPosting,
): Promise<string> {
  const rows = await (tx as typeof db)
    .insert(wcPostingLedger)
    .values({
      tenantId: p.tenantId,
      employeeId: p.employeeId,
      officeId: p.officeId,
      postId: p.postId,
      chargeType: p.chargeType,
      effectiveFrom: p.effectiveFrom,
      effectiveTo: null,
      orderRef: p.orderRef,
      createdBy: p.actorId,
    })
    .returning({ id: wcPostingLedger.id });
  return rows[0]!.id;
}

/**
 * Append a posting-ledger row with NO sanctioned post (post_id NULL), used by
 * the legacy transfer paths which move by office only (ST-M01-09 thin callers).
 */
export async function appendLegacyLedgerSpan(
  tx: Writer,
  p: {
    tenantId: string;
    employeeId: string;
    officeId: string;
    effectiveFrom: string;
    orderRef: string | null;
    actorId: string;
  },
): Promise<string> {
  const rows = await (tx as typeof db)
    .insert(wcPostingLedger)
    .values({
      tenantId: p.tenantId,
      employeeId: p.employeeId,
      officeId: p.officeId,
      postId: null,
      chargeType: "substantive",
      effectiveFrom: p.effectiveFrom,
      effectiveTo: null,
      orderRef: p.orderRef,
      createdBy: p.actorId,
    })
    .returning({ id: wcPostingLedger.id });
  return rows[0]!.id;
}

/**
 * The employee's current office/designation/station fields — read inside the
 * tx both to compute the fromOfficeId for the rich event and to carry
 * station/state/city-class forward onto the event (the ONLY sources that exist
 * in Workforce Core today).
 */
export interface EmployeeSnapshot {
  departmentId: string;
  designationId: string | null;
  station: string | null;
  state: string | null;
  hraCityClass: string;
}

export async function findEmployee(
  tx: Writer,
  employeeId: string,
): Promise<EmployeeSnapshot | undefined> {
  const rows = await (tx as typeof db)
    .select({
      departmentId: hrmsEmployees.departmentId,
      designationId: hrmsEmployees.designationId,
      station: hrmsEmployees.station,
      state: hrmsEmployees.workStateCode,
      hraCityClass: hrmsEmployees.hraCityClass,
    })
    .from(hrmsEmployees)
    .where(eq(hrmsEmployees.id, employeeId))
    .limit(1);
  return rows[0];
}

/**
 * Update the employee's current office (department) + designation to the new
 * post's. Guarded on the employee existing (RLS scopes to tenant). Returns the
 * number of rows updated so the caller can refuse an unknown employee.
 */
export async function updateEmployeeCurrentPost(
  tx: Writer,
  employeeId: string,
  officeId: string,
  designationId: string | null,
  actorId: string,
): Promise<number> {
  // version is bumped so a concurrent versioned employee edit (optimistic
  // lock on `version`) is detected rather than silently overwritten.
  const set: Record<string, unknown> = {
    departmentId: officeId,
    updatedBy: actorId,
    version: sql`${hrmsEmployees.version} + 1`,
  };
  if (designationId) set.designationId = designationId;
  const rows = await (tx as typeof db)
    .update(hrmsEmployees)
    .set(set)
    .where(eq(hrmsEmployees.id, employeeId))
    .returning({ id: hrmsEmployees.id });
  return rows.length;
}

/** Append a service-book entry for the posting (the existing service-book table). */
export async function appendServiceBookEntry(
  tx: Writer,
  p: {
    tenantId: string;
    employeeId: string;
    effectiveDate: string;
    description: string;
    recordedBy: string;
    documentRef: string | null;
  },
): Promise<void> {
  await (tx as typeof db).insert(hrmsServiceBookEntries).values({
    tenantId: p.tenantId,
    employeeId: p.employeeId,
    entryType: "posting",
    effectiveDate: p.effectiveDate,
    description: p.description,
    recordedBy: p.recordedBy,
    documentRef: p.documentRef,
  });
}

/** ISO 'YYYY-MM-DD' one day before the given date (to close the previous span). */
export function dayBefore(isoDate: string): string {
  const d = new Date(`${isoDate}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() - 1);
  return d.toISOString().slice(0, 10);
}
