/**
 * UAT b18 D1 (EPF for contract staff, 2026-11-05): change an employee's
 * pension scheme (GPF / NPS / EPF / UPS) with an effective-from month,
 * maker-checker. There was no API at all: the 6 contract staff were moved
 * NPS -> EPF by direct SQL with no audit and no effective date.
 *
 *   POST /v1/hrms/employees/:id/pension-scheme-changes        maker (HR)
 *   POST /v1/hrms/pension-scheme-changes/:changeId/approve    checker != maker
 *   POST /v1/hrms/pension-scheme-changes/:changeId/reject     checker != maker
 *   GET  /v1/hrms/employees/:id/pension-scheme-changes        history
 *   GET  /v1/hrms/pension-scheme-changes?status=pending       checker queue
 *
 * Rules:
 *  - effectiveFrom is the first day of a wage month (one scheme per period),
 *    not before the joining month, and after the last approved change (a
 *    linear history; a correction is a further change).
 *  - reason is mandatory (>= 10 chars); every step is audited with the
 *    before / after scheme.
 *  - EPF needs a valid 12-digit UAN (on file, or supplied with the request and
 *    written on approval): 422 UAN_REQUIRED otherwise (D3).
 *  - the approver must be a different user from the requester (403
 *    MAKER_CHECKER_VIOLATION).
 *  - on approval hrms_employees.pension_scheme switches at once if the change
 *    is already effective, else on its effective date (worker tick,
 *    pension-scheme-scheduler.ts). Payroll reads the scheme in effect for each
 *    month from the approved history (internal payroll-input), so earlier
 *    periods keep the old scheme. Slips already computed are never changed: the
 *    approval returns the retro periods and the payroll report that lists them
 *    (report only, nothing is posted).
 *
 * Commands (the write side). The thin HTTP layer is pension-scheme-routes.ts.
 * Synchronous (not a queued command), like login-link.ts: the preconditions
 * must be answered to the caller, and one transaction holds the row locks, the
 * writes and the audit outbox event.
 */
import { z } from "zod";
import { and, eq, sql } from "drizzle-orm";
import type { RequestContext } from "@civitasone/types";
import { db } from "../../shared/db.js";
import { cache } from "../../shared/infra.js";
import { enqueue } from "../../shared/outbox.js";
import { HttpError } from "../../shared/context.js";
import { todayIST } from "../../shared/ist.js";
import { hrmsEmployees, hrmsPensionSchemeChanges, type PensionSchemeChangeRow } from "./schema.js";
import { isExitedStatus } from "./status.js";
import { PENSION_SCHEMES, NO_SCHEME, isValidUan, retroPeriods, schemeForMonth, schemeChangeVerdict, type ApprovedSchemeChange } from "./pension-scheme.js";

const AUDIT = "audit.event.record";
export const MAKER_ROLES = ["hr_admin", "hr_officer", "super_admin"];
export const CHECKER_ROLES = ["hr_admin", "super_admin"];
export const READER_ROLES = ["hr_admin", "hr_officer", "super_admin", "payroll_admin", "payroll_officer"];

export const PENSION_SCHEME_ERRORS = {
  UNCHANGED: "PENSION_SCHEME_UNCHANGED",
  PENDING: "PENSION_SCHEME_CHANGE_PENDING",
  NOT_PENDING: "PENSION_SCHEME_CHANGE_NOT_PENDING",
  BEFORE_JOINING: "PENSION_SCHEME_EFFECTIVE_BEFORE_JOINING",
  NOT_AFTER_LAST: "PENSION_SCHEME_EFFECTIVE_NOT_AFTER_LAST",
  UAN_REQUIRED: "UAN_REQUIRED",
  MAKER_CHECKER: "MAKER_CHECKER_VIOLATION",
  // Review SF5: outside the eligibility matrix, and an override by a non-super_admin.
  NOT_ALLOWED: "PENSION_SCHEME_NOT_ALLOWED",
  OVERRIDE_FORBIDDEN: "PENSION_SCHEME_OVERRIDE_FORBIDDEN",
  // Delta review: the joining wage is stamped once and never overwritten.
  JOINING_WAGE_RECORDED: "EPF_JOINING_WAGE_RECORDED",
} as const;

/** Review SF5: only a super_admin may record a change outside the matrix (with a reason). */
export const OVERRIDE_ROLES = ["super_admin"];

export const idParam = z.object({ id: z.string().uuid() });
export const changeIdParam = z.object({ changeId: z.string().uuid() });
export const pensionSchemeChangeBody = z.object({
  // Delta review SF3: NONE for apprentices / consultants (matrix-checked).
  toScheme: z.enum([...PENSION_SCHEMES, NO_SCHEME]),
  effectiveFrom: z.string().regex(/^\d{4}-(0[1-9]|1[0-2])-01$/, "effectiveFrom must be the first day of a month (YYYY-MM-01)"),
  reason: z.string().trim().min(10, "reason must be at least 10 characters").max(500),
  uanNumber: z.string().trim().regex(/^\d{12}$/, "UAN must be exactly 12 digits").optional(),
  // Review SF5: a change outside the eligibility matrix (e.g. a DoPPW old-pension
  // option order) needs this, recorded by a super_admin.
  overrideReason: z.string().trim().min(20, "overrideReason must be at least 20 characters").max(500).optional(),
  // Review SF1: EPF membership facts for EPS eligibility (EPF only). With
  // toScheme = the scheme already in effect (EPF), only these change.
  epfFirstJoinedOn: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "must be YYYY-MM-DD").optional(),
  epfVoluntaryJointOption: z.boolean().optional(),
  epsMember: z.boolean().optional(),
  // Delta review: EPF wages (Basic + DA, paise) at first joining EPF; stamped once.
  epfJoiningWageMinor: z.number().int().nonnegative().max(1_000_000_000).optional(),
}).strict().refine(
  (b) => b.toScheme === "EPF" || (b.epfFirstJoinedOn === undefined && b.epfVoluntaryJointOption === undefined && b.epsMember === undefined && b.epfJoiningWageMinor === undefined),
  { message: "EPF membership details can only be given for EPF", path: ["toScheme"] },
);

type ChangeBody = z.infer<typeof pensionSchemeChangeBody>;
const hasMembership = (b: Pick<ChangeBody, "epfFirstJoinedOn" | "epfVoluntaryJointOption" | "epsMember" | "epfJoiningWageMinor">): boolean =>
  b.epfFirstJoinedOn !== undefined || b.epfVoluntaryJointOption !== undefined || b.epsMember !== undefined || b.epfJoiningWageMinor !== undefined;

function assertAllowed(ctx: RequestContext | null, emp: { employeeType: string; dateOfJoining: string }, fromScheme: string, toScheme: string,
  history: ApprovedSchemeChange[], overrideReason: string | null | undefined): void {
  const v = schemeChangeVerdict({ employeeType: emp.employeeType, dateOfJoining: emp.dateOfJoining, fromScheme, toScheme, history });
  if (v.ok) return;
  if (!overrideReason) {
    throw new HttpError(422, PENSION_SCHEME_ERRORS.NOT_ALLOWED, `${fromScheme} -> ${toScheme} is not allowed: ${v.reason}. A super_admin can record it with an override reason.`);
  }
  if (ctx && !OVERRIDE_ROLES.some((r) => ctx.roles.includes(r))) {
    throw new HttpError(403, PENSION_SCHEME_ERRORS.OVERRIDE_FORBIDDEN, "only a super_admin can record a pension scheme change outside the eligibility rules");
  }
}
export const approveBody = z.object({ note: z.string().trim().max(500).optional() }).strict();
export const rejectBody = z.object({ note: z.string().trim().min(3, "note must be at least 3 characters").max(500) }).strict();
export const listQuery = z.object({ status: z.enum(["pending", "approved", "rejected"]).optional() });

type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0];

export function shape(r: PensionSchemeChangeRow) {
  return {
    id: r.id, employeeId: r.employeeId, fromScheme: r.fromScheme, toScheme: r.toScheme,
    effectiveFrom: r.effectiveFrom, reason: r.reason, uanNumber: r.uanNumber ?? null, status: r.status, kind: r.kind,
    overrideReason: r.overrideReason ?? null,
    epfFirstJoinedOn: r.epfFirstJoinedOn ?? null, epfVoluntaryJointOption: r.epfVoluntaryJointOption ?? null, epsMember: r.epsMember ?? null,
    epfJoiningWageMinor: r.epfJoiningWageMinor != null ? r.epfJoiningWageMinor.toString() : null,
    requestedBy: r.requestedBy, decidedBy: r.decidedBy ?? null,
    decidedAt: r.decidedAt ? r.decidedAt.toISOString() : null, decisionNote: r.decisionNote ?? null,
    appliedAt: r.appliedAt ? r.appliedAt.toISOString() : null, createdAt: r.createdAt.toISOString(),
  };
}

async function lockEmployee(tx: Tx, tenantId: string, employeeId: string) {
  const [emp] = await tx.select({
    id: hrmsEmployees.id, status: hrmsEmployees.status, pensionScheme: hrmsEmployees.pensionScheme,
    uanNumber: hrmsEmployees.uanNumber, dateOfJoining: hrmsEmployees.dateOfJoining, employeeNo: hrmsEmployees.employeeNo,
    employeeType: hrmsEmployees.employeeType, epfFirstJoinedOn: hrmsEmployees.epfFirstJoinedOn,
    epfVoluntaryJointOption: hrmsEmployees.epfVoluntaryJointOption, epsMember: hrmsEmployees.epsMember,
    epfJoiningWageMinor: hrmsEmployees.epfJoiningWageMinor,
  }).from(hrmsEmployees)
    .where(and(eq(hrmsEmployees.id, employeeId), eq(hrmsEmployees.tenantId, tenantId)))
    .for("update").limit(1);
  if (!emp) throw new HttpError(404, "NOT_FOUND", "employee not found");
  if (isExitedStatus(emp.status)) {
    throw new HttpError(409, "EMPLOYEE_EXITED", `employee has status '${emp.status}' and their pension scheme can no longer be changed`);
  }
  return emp;
}

async function approvedHistory(tx: Tx, tenantId: string, employeeId: string): Promise<ApprovedSchemeChange[]> {
  const rows = await tx.select({ fromScheme: hrmsPensionSchemeChanges.fromScheme, toScheme: hrmsPensionSchemeChanges.toScheme, effectiveFrom: hrmsPensionSchemeChanges.effectiveFrom })
    .from(hrmsPensionSchemeChanges)
    .where(and(eq(hrmsPensionSchemeChanges.tenantId, tenantId), eq(hrmsPensionSchemeChanges.employeeId, employeeId), eq(hrmsPensionSchemeChanges.status, "approved")));
  return rows;
}

function assertAfterLast(history: ApprovedSchemeChange[], effectiveFrom: string): void {
  const last = history.reduce<string | null>((m, c) => (m == null || c.effectiveFrom > m ? c.effectiveFrom : m), null);
  if (last != null && effectiveFrom <= last) {
    throw new HttpError(409, PENSION_SCHEME_ERRORS.NOT_AFTER_LAST, `effectiveFrom must be after the last approved scheme change (effective ${last})`);
  }
}

function assertUan(toScheme: string, uan: string | null | undefined): void {
  if (toScheme === "EPF" && !isValidUan(uan)) {
    throw new HttpError(422, PENSION_SCHEME_ERRORS.UAN_REQUIRED, "An EPF member needs a valid 12-digit UAN. Record the UAN on the employee or send uanNumber with the request.");
  }
}

async function audit(tx: Tx, ctx: RequestContext, action: string, resourceId: string, extra: Record<string, unknown>): Promise<void> {
  await enqueue(tx, {
    topic: AUDIT, eventType: AUDIT,
    tenantId: ctx.tenantId, actorId: ctx.actorId, correlationId: ctx.correlationId,
    payload: { service: "hrms", action, resourceType: "employee", resourceId, outcome: "success", ...extra },
  });
}

async function invalidate(tenantId: string, employeeId: string): Promise<void> {
  await cache.invalidate(cache.makeKey(tenantId, "employee", employeeId));
  await cache.invalidateResource(tenantId, "employee");
}

export async function requestPensionSchemeChange(ctx: RequestContext, employeeId: string, body: ChangeBody) {
  return db.transaction(async (tx) => {
    const emp = await lockEmployee(tx, ctx.tenantId, employeeId);
    if (body.effectiveFrom < `${emp.dateOfJoining.slice(0, 7)}-01`) {
      throw new HttpError(422, PENSION_SCHEME_ERRORS.BEFORE_JOINING, `effectiveFrom cannot be before the joining month (${emp.dateOfJoining.slice(0, 7)})`);
    }
    const [pending] = await tx.select({ id: hrmsPensionSchemeChanges.id }).from(hrmsPensionSchemeChanges)
      .where(and(eq(hrmsPensionSchemeChanges.tenantId, ctx.tenantId), eq(hrmsPensionSchemeChanges.employeeId, employeeId), eq(hrmsPensionSchemeChanges.status, "pending")))
      .limit(1);
    if (pending) throw new HttpError(409, PENSION_SCHEME_ERRORS.PENDING, "a pension scheme change for this employee is already waiting for approval");
    const history = await approvedHistory(tx, ctx.tenantId, employeeId);
    assertAfterLast(history, body.effectiveFrom);
    const fromScheme = schemeForMonth(emp.pensionScheme, history, body.effectiveFrom.slice(0, 7));
    // Review SF1: EPF -> EPF is a membership update (UAN / first EPF joining /
    // joint option / EPS membership) -- the only no-op scheme request allowed.
    let kind: "change" | "membership" = "change";
    if (fromScheme === body.toScheme) {
      if (body.toScheme !== "EPF" || !(hasMembership(body) || (body.uanNumber && body.uanNumber !== emp.uanNumber))) {
        throw new HttpError(409, PENSION_SCHEME_ERRORS.UNCHANGED, `the employee is already on ${body.toScheme} from ${body.effectiveFrom}`);
      }
      kind = "membership";
    } else {
      assertAllowed(ctx, emp, fromScheme, body.toScheme, history, body.overrideReason);
    }
    assertUan(body.toScheme, body.uanNumber ?? emp.uanNumber);
    if (body.epfJoiningWageMinor !== undefined && emp.epfJoiningWageMinor != null && BigInt(body.epfJoiningWageMinor) !== emp.epfJoiningWageMinor) {
      throw new HttpError(409, PENSION_SCHEME_ERRORS.JOINING_WAGE_RECORDED, "the EPF joining wage is already recorded for this employee and is not changed by a later request");
    }
    const [row] = await tx.insert(hrmsPensionSchemeChanges).values({
      tenantId: ctx.tenantId, employeeId, fromScheme, toScheme: body.toScheme, effectiveFrom: body.effectiveFrom,
      reason: body.reason, uanNumber: body.uanNumber ?? null, status: "pending", kind,
      overrideReason: body.overrideReason ?? null,
      epfFirstJoinedOn: body.epfFirstJoinedOn ?? null,
      epfVoluntaryJointOption: body.epfVoluntaryJointOption ?? null,
      epsMember: body.epsMember ?? null,
      epfJoiningWageMinor: body.epfJoiningWageMinor != null ? BigInt(body.epfJoiningWageMinor) : null,
      requestedBy: ctx.actorId, createdBy: ctx.actorId, updatedBy: ctx.actorId,
    }).returning();
    await audit(tx, ctx, "pension_scheme_change_request", employeeId, {
      oldValue: { pensionScheme: fromScheme },
      newValue: { pensionScheme: body.toScheme, effectiveFrom: body.effectiveFrom, kind,
        ...(hasMembership(body) ? { epfFirstJoinedOn: body.epfFirstJoinedOn ?? null, epfVoluntaryJointOption: body.epfVoluntaryJointOption ?? null, epsMember: body.epsMember ?? null, epfJoiningWageMinor: body.epfJoiningWageMinor ?? null } : {}) },
      reason: body.reason,
      detail: { changeId: row!.id, uanSupplied: body.uanNumber != null, ...(body.overrideReason ? { overrideReason: body.overrideReason } : {}) },
    });
    return shape(row!);
  });
}

async function lockPendingChange(tx: Tx, ctx: RequestContext, changeId: string): Promise<PensionSchemeChangeRow> {
  const [c] = await tx.select().from(hrmsPensionSchemeChanges)
    .where(and(eq(hrmsPensionSchemeChanges.id, changeId), eq(hrmsPensionSchemeChanges.tenantId, ctx.tenantId)))
    .for("update").limit(1);
  if (!c) throw new HttpError(404, "NOT_FOUND", "pension scheme change not found");
  if (c.status !== "pending") throw new HttpError(409, PENSION_SCHEME_ERRORS.NOT_PENDING, `this change is already ${c.status}`);
  if (c.requestedBy === ctx.actorId) {
    throw new HttpError(403, PENSION_SCHEME_ERRORS.MAKER_CHECKER, "a pension scheme change must be decided by a different user from the one who requested it");
  }
  return c;
}

export async function approvePensionSchemeChange(ctx: RequestContext, changeId: string, body: z.infer<typeof approveBody>) {
  const result = await db.transaction(async (tx) => {
    const c = await lockPendingChange(tx, ctx, changeId);
    const emp = await lockEmployee(tx, ctx.tenantId, c.employeeId);
    assertUan(c.toScheme, c.uanNumber ?? emp.uanNumber);
    const history = await approvedHistory(tx, ctx.tenantId, c.employeeId);
    assertAfterLast(history, c.effectiveFrom);
    // Review SF5: re-checked at approval (history may have moved); an override
    // recorded by the super_admin requester stands.
    if (c.kind === "change") assertAllowed(null, emp, c.fromScheme, c.toScheme, history, c.overrideReason);
    const today = todayIST();
    const applyNow = c.effectiveFrom <= today;
    const now = new Date();
    const [row] = await tx.update(hrmsPensionSchemeChanges).set({
      status: "approved", decidedBy: ctx.actorId, decidedAt: now, decisionNote: body.note ?? null,
      appliedAt: applyNow ? now : null, updatedBy: ctx.actorId, updatedAt: now,
      version: sql`${hrmsPensionSchemeChanges.version} + 1`,
    }).where(and(eq(hrmsPensionSchemeChanges.id, c.id), eq(hrmsPensionSchemeChanges.tenantId, ctx.tenantId))).returning();
    const empPatch: Partial<typeof hrmsEmployees.$inferInsert> = {};
    if (applyNow) empPatch.pensionScheme = c.toScheme;
    if (c.uanNumber && c.uanNumber !== emp.uanNumber) empPatch.uanNumber = c.uanNumber;
    // Review SF1: EPF membership facts are facts, applied on approval.
    if (c.epfFirstJoinedOn != null) empPatch.epfFirstJoinedOn = c.epfFirstJoinedOn;
    if (c.epfVoluntaryJointOption != null) empPatch.epfVoluntaryJointOption = c.epfVoluntaryJointOption;
    if (c.epsMember != null) empPatch.epsMember = c.epsMember;
    // Delta review: the joining wage is stamped once (never overwritten).
    if (c.epfJoiningWageMinor != null && emp.epfJoiningWageMinor == null) empPatch.epfJoiningWageMinor = c.epfJoiningWageMinor;
    if (Object.keys(empPatch).length > 0) {
      await tx.update(hrmsEmployees)
        .set({ ...empPatch, updatedBy: ctx.actorId, updatedAt: now, version: sql`${hrmsEmployees.version} + 1` })
        .where(and(eq(hrmsEmployees.id, c.employeeId), eq(hrmsEmployees.tenantId, ctx.tenantId)));
    }
    const retro = retroPeriods(c.effectiveFrom, today);
    await audit(tx, ctx, "pension_scheme_change", c.employeeId, {
      oldValue: { pensionScheme: c.fromScheme, ...(empPatch.uanNumber ? { uanNumber: emp.uanNumber ?? null } : {}),
        ...(c.kind === "membership" || c.epfFirstJoinedOn != null || c.epfVoluntaryJointOption != null || c.epsMember != null
          ? { epfFirstJoinedOn: emp.epfFirstJoinedOn ?? null, epfVoluntaryJointOption: emp.epfVoluntaryJointOption, epsMember: emp.epsMember ?? null } : {}) },
      newValue: { pensionScheme: c.toScheme, effectiveFrom: c.effectiveFrom, appliedNow: applyNow, kind: c.kind, ...(empPatch.uanNumber ? { uanNumber: empPatch.uanNumber } : {}),
        ...(c.epfFirstJoinedOn != null ? { epfFirstJoinedOn: c.epfFirstJoinedOn } : {}),
        ...(c.epfVoluntaryJointOption != null ? { epfVoluntaryJointOption: c.epfVoluntaryJointOption } : {}),
        ...(c.epsMember != null ? { epsMember: c.epsMember } : {}),
        ...(empPatch.epfJoiningWageMinor != null ? { epfJoiningWageMinor: empPatch.epfJoiningWageMinor.toString() } : {}) },
      reason: c.reason,
      detail: { changeId: c.id, requestedBy: c.requestedBy, approvedBy: ctx.actorId, note: body.note ?? null, retroPeriods: retro,
        ...(c.overrideReason ? { overrideReason: c.overrideReason } : {}) },
    });
    return {
      ...shape(row!),
      appliedNow: applyNow,
      retroPeriods: retro,
      retro: {
        policy: "report_only" as const,
        note: retro.length > 0
          ? "Slips already computed for these periods keep the old scheme; nothing is recalculated or posted. Review them in the payroll retro report."
          : "No past period is affected.",
        report: `/v1/payroll/reports/pension-scheme-retro?employeeId=${c.employeeId}&fromMonth=${c.effectiveFrom.slice(0, 7)}&toScheme=${c.toScheme}`,
      },
    };
  });
  await invalidate(ctx.tenantId, result.employeeId);
  return result;
}

export async function rejectPensionSchemeChange(ctx: RequestContext, changeId: string, body: z.infer<typeof rejectBody>) {
  return db.transaction(async (tx) => {
    const c = await lockPendingChange(tx, ctx, changeId);
    const now = new Date();
    const [row] = await tx.update(hrmsPensionSchemeChanges).set({
      status: "rejected", decidedBy: ctx.actorId, decidedAt: now, decisionNote: body.note,
      updatedBy: ctx.actorId, updatedAt: now, version: sql`${hrmsPensionSchemeChanges.version} + 1`,
    }).where(and(eq(hrmsPensionSchemeChanges.id, c.id), eq(hrmsPensionSchemeChanges.tenantId, ctx.tenantId))).returning();
    await audit(tx, ctx, "pension_scheme_change_reject", c.employeeId, {
      oldValue: { pensionScheme: c.fromScheme },
      newValue: { pensionScheme: c.fromScheme, rejectedScheme: c.toScheme, effectiveFrom: c.effectiveFrom },
      reason: body.note,
      detail: { changeId: c.id, requestedBy: c.requestedBy, rejectedBy: ctx.actorId },
    });
    return shape(row!);
  });
}
