import { eq, and, inArray, lte, sql } from "drizzle-orm";
import { db } from "../../shared/db.js";
import { hrmsTransfers, hrmsPromotions, hrmsSeparations, type TransferRow, type PromotionRow } from "./schema.js";
import * as employeeRepo from "../employee/repo.js";
import { HttpError } from "../../shared/context.js";

export type Writer = Pick<typeof db, "insert" | "update" | "select">;

export async function insertTransfer(tx: Writer, row: typeof hrmsTransfers.$inferInsert): Promise<void> {
  await tx.insert(hrmsTransfers).values(row);
}

type TransferSet = Partial<Pick<
  typeof hrmsTransfers.$inferInsert,
  "orderNo" | "orderDate" | "orderRef" | "relievedDate" | "joinedDate"
>>;

/**
 * Guarded state transition for a transfer order. Only flips status when the
 * current status is in `from`; bumps version + updatedAt. Returns the updated
 * row, or null when the guard rejected (wrong state / not found).
 */
export async function transitionTransfer(
  tenantId: string,
  id: string,
  actorId: string,
  opts: { from: string[]; to: string; set?: TransferSet },
  tx: Writer = db,
): Promise<TransferRow | null> {
  const rows = await tx.update(hrmsTransfers)
    .set({
      ...opts.set,
      status: opts.to,
      updatedBy: actorId,
      updatedAt: new Date(),
      version: sql`${hrmsTransfers.version} + 1`,
    })
    .where(and(
      eq(hrmsTransfers.id, id),
      eq(hrmsTransfers.tenantId, tenantId),
      inArray(hrmsTransfers.status, opts.from),
    ))
    .returning();
  return rows[0] ?? null;
}

export async function insertPromotion(tx: Writer, row: typeof hrmsPromotions.$inferInsert): Promise<void> {
  await tx.insert(hrmsPromotions).values(row);
}

/**
 * Guarded state transition for a promotion request. Mirrors `transitionTransfer`:
 * only flips status when the current status is in `from`; bumps version +
 * updatedAt. Returns the updated row, or null when the guard rejected (wrong
 * state / not found / wrong tenant). Used by the eOffice decision consumer to
 * idempotently and tenant-safely apply an approval/rejection.
 */
export async function transitionPromotion(
  tenantId: string,
  id: string,
  actorId: string,
  opts: { from: string[]; to: string },
  tx: Writer = db,
): Promise<PromotionRow | null> {
  const rows = await tx.update(hrmsPromotions)
    .set({
      status: opts.to,
      updatedBy: actorId,
      updatedAt: new Date(),
      version: sql`${hrmsPromotions.version} + 1`,
    })
    .where(and(
      eq(hrmsPromotions.id, id),
      eq(hrmsPromotions.tenantId, tenantId),
      inArray(hrmsPromotions.status, opts.from),
    ))
    .returning();
  return rows[0] ?? null;
}

export async function insertSeparation(tx: Writer, row: typeof hrmsSeparations.$inferInsert): Promise<void> {
  await tx.insert(hrmsSeparations).values(row);
}

/**
 * Effective-dating fix (see migration 0144): ISO 'YYYY-MM-DD' string
 * comparison is chronological for this format — matches the convention
 * already used throughout this codebase (scheduler/tick.ts's todayISO(),
 * leave/rules-engine.ts's date-range helpers). `effectiveDate` is due when
 * it is today or earlier as of `asOf`.
 */
export function isEffectiveDateDue(effectiveDate: string, asOf: string): boolean {
  return effectiveDate <= asOf;
}

/**
 * Tenant-scoped due-row discovery for the effective-changes scheduler
 * (lifecycle/effective-scheduler.ts). Ordinary, fully RLS-enforced queries
 * — ONLY correct when called inside runWithTenant(tenantId, ...) so the
 * strict tenant_isolation policy has a GUC to match against.
 *
 * Replaces migration 0144's original due_promotion_ids/due_transfer_ids
 * SECURITY DEFINER SQL functions (dropped by migration 0146): those could
 * never return cross-tenant rows in the first place — neither hrms_svc
 * (the role a SECURITY DEFINER function here actually runs as, being its
 * owner) nor civitas_admin has BYPASSRLS, by design. The real fix is this
 * per-tenant loop, discovering the tenant universe via shared/db.ts's
 * scopedPlatformRead (employee.hrms_employees already carries a
 * platform_bypass SELECT policy from migration 0133) and then re-entering
 * each tenant's own strict RLS context — see effective-scheduler.ts's doc
 * comment for the full mechanism. Explicit tenantId filter below is
 * defense-in-depth alongside RLS, matching transitionTransfer/
 * transitionPromotion's convention in this same file.
 */
export async function dueTenantPromotionIds(tx: Writer, tenantId: string, runDate: string): Promise<string[]> {
  const rows = await (tx as typeof db).select({ id: hrmsPromotions.id }).from(hrmsPromotions)
    .where(and(
      eq(hrmsPromotions.tenantId, tenantId),
      eq(hrmsPromotions.status, "pending_effective"),
      lte(hrmsPromotions.effectiveDate, runDate),
    ));
  return rows.map((r) => r.id);
}

export async function dueTenantTransferIds(tx: Writer, tenantId: string, runDate: string): Promise<string[]> {
  const rows = await (tx as typeof db).select({ id: hrmsTransfers.id }).from(hrmsTransfers)
    .where(and(
      eq(hrmsTransfers.tenantId, tenantId),
      eq(hrmsTransfers.status, "pending_effective"),
      lte(hrmsTransfers.effectiveDate, runDate),
    ));
  return rows.map((r) => r.id);
}

/**
 * Applies an already-decided promotion's designation (and, when carried,
 * basic pay) to the employee master. Shared by every path that can move a
 * promotion into its "completed" state — the direct-create route
 * (lifecycle/consumer.ts), the eOffice-approved route
 * (promotion-eoffice-consumer.ts), and the scheduler that later applies a
 * promotion whose effectiveDate has finally arrived
 * (lifecycle/effective-scheduler.ts) — so all three can never drift in what
 * "apply this promotion" means.
 *
 * Uses the SAME optimistic-concurrency guard (read version, write
 * conditionally on it) as every other writer of hrms_employees.basicMinor —
 * see employee/repo.ts's updateEmployeeVersioned doc comment for why this
 * matters: basicMinor is written by several independent, asynchronous
 * consumers that can legitimately race each other.
 */
export async function applyPromotionEffect(
  tx: Writer,
  promotion: Pick<PromotionRow, "tenantId" | "employeeId" | "toDesigId" | "newBasicMinor">,
  actorId: string,
): Promise<void> {
  const emp = await employeeRepo.findVersionForUpdate(tx, promotion.employeeId, promotion.tenantId);
  if (!emp) throw new HttpError(404, "NOT_FOUND", `employee ${promotion.employeeId} not found`);
  const patch: Record<string, unknown> = { designationId: promotion.toDesigId };
  if (promotion.newBasicMinor !== null) patch.basicMinor = promotion.newBasicMinor;
  await employeeRepo.updateEmployeeVersioned(tx, promotion.employeeId, promotion.tenantId, emp.version, patch, actorId);
}

/**
 * Applies an already-decided transfer's posting (department, and designation
 * when carried) to the employee master. Shared by the direct-transfer route
 * (employee/consumer.ts), the eOffice-approved route (eoffice-consumer.ts),
 * and the scheduler that later applies a transfer whose effectiveDate has
 * arrived (lifecycle/effective-scheduler.ts).
 *
 * Deliberately does NOT touch hrms_employees.status. The direct-transfer path
 * used to also set status: "transferred" — that value was never part of the
 * canonical employee status contract (employee/status.ts's EMPLOYEE_STATUSES
 * / the hrms_employees_status_check CHECK constraint added by migration 0025
 * and never widened for it, unlike "no_show" in 0130), so that write always
 * violated the CHECK constraint and silently rolled back the WHOLE
 * transaction — the same failure class migration 0130's own comment
 * documents for "no_show". Removed rather than reproduced here; see
 * employee/consumer.ts's employeeTransfer handler.
 *
 * Bug 2 fix (version-guard parity with applyPromotionEffect above): this
 * used to be a PLAIN (non-versioned) update via employeeRepo.updateEmployee
 * — a blind overwrite with no precondition, on the reasoning that no
 * transfer-effecting path had ever raced updateEmployeeVersioned's guarded
 * field (basicMinor). Now that transfers can be DEFERRED by days or weeks
 * via the scheduler (migration 0144), a newer, independent change to the
 * SAME employee landing before the deferred transfer's effective date is a
 * realistic, expected scenario, not just a narrow theoretical race — and a
 * blind overwrite would silently apply on top of (or under, for
 * whole-row-replace-style callers) whatever changed in between with no
 * error and no audit trail, exactly the failure class
 * updateEmployeeVersioned exists to catch. Reads the row's current version
 * fresh (inside this transaction, same as applyPromotionEffect) and writes
 * through updateEmployeeVersioned so a genuinely conflicting concurrent
 * write throws (409 EMPLOYEE_VERSION_CONFLICT) instead of being silently
 * discarded — see employee/repo.ts's updateEmployeeVersioned doc comment.
 */
export async function applyTransferEffect(
  tx: Writer,
  transfer: Pick<TransferRow, "tenantId" | "employeeId" | "toDeptId" | "toDesigId">,
  actorId: string,
): Promise<void> {
  const emp = await employeeRepo.findVersionForUpdate(tx, transfer.employeeId, transfer.tenantId);
  if (!emp) throw new HttpError(404, "NOT_FOUND", `employee ${transfer.employeeId} not found`);
  const patch: Record<string, unknown> = { departmentId: transfer.toDeptId };
  if (transfer.toDesigId) patch.designationId = transfer.toDesigId;
  await employeeRepo.updateEmployeeVersioned(tx, transfer.employeeId, transfer.tenantId, emp.version, patch, actorId);
}
