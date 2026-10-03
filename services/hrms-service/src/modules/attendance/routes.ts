import { randomUUID } from "node:crypto";
import type { FastifyInstance } from "fastify";
import { ZodError, z } from "zod";
import { acceptedResponseSchema, listQuerySchema } from "@civitasone/schemas/common";
import { attendanceSummaryResponseSchema, AttendanceRegularisationListSchema, AttendanceSummaryListSchema } from "@civitasone/schemas/web";
import {sendValidated, sendAccepted } from "@civitasone/schemas/validate";
import type { RequestContext } from "@civitasone/types";
import { resolveContext, requireRole, HttpError } from "../../shared/context.js";
import { publishF3Write } from "../../shared/f3-publish.js";
import { markAttendanceBody, regularisationCreateBody, periodLockBody, type ResolvedRegularisationBody } from "./validators.js";
import * as commands from "./commands.js";
import * as queries from "./queries.js";
import * as repo from "./repo.js";
import * as employeeRepo from "../employee/repo.js";
import { resolveEmployeeForActor } from "../employee/actor-link.js";
import { scopedRead } from "../../shared/db.js";
import { batchEmployees } from "../../shared/batch-resolve.js";
import { hrmsOvertimeRequests, hrmsWfhRequests, hrmsShiftChangeRequests, hrmsAttendanceRegularisations } from "./schema.js";
import { hrmsEmployees } from "../employee/schema.js";
import { eq, and, desc, inArray, count, gte, lte } from "drizzle-orm";
import type { AnyPgColumn } from "drizzle-orm/pg-core";

/**
 * Builds the drizzle WHERE condition for an employeeId column from a
 * resolved scope (see resolveSelfScopedEmployeeId): a concrete array uses
 * inArray, a single id uses eq, and undefined/empty leaves the column
 * unfiltered (empty is only ever passed here after the caller has already
 * short-circuited to an empty response -- see isEmptyScope below -- so this
 * never accidentally turns "authorized for nothing" into "unfiltered").
 */
function employeeScopeCondition(column: AnyPgColumn, scope: string | string[] | undefined | null) {
  if (Array.isArray(scope)) return scope.length > 0 ? inArray(column, scope) : undefined;
  return scope ? eq(column, scope) : undefined;
}

/** True when a resolved scope means "authorized for nothing" -- caller must respond with an empty list, never fall through to unfiltered. */
function isEmptyScope(scope: string | string[] | undefined | null): boolean {
  return scope === null || (Array.isArray(scope) && scope.length === 0);
}

/**
 * The Mon-Sun calendar week (as "YYYY-MM-DD" bounds) containing `dateStr`,
 * computed in UTC. Used by GAP-HR-WFH-01's weekly-cap check below; see that
 * call site for why UTC (coarse) rather than IST-precise is the deliberate
 * choice here.
 */
function isoWeekBoundsUtc(dateStr: string): { start: string; end: string } {
  const d = new Date(`${dateStr}T00:00:00.000Z`);
  const day = d.getUTCDay(); // 0=Sun..6=Sat
  const mondayOffset = day === 0 ? -6 : 1 - day;
  const monday = new Date(d);
  monday.setUTCDate(d.getUTCDate() + mondayOffset);
  const sunday = new Date(monday);
  sunday.setUTCDate(monday.getUTCDate() + 6);
  return { start: monday.toISOString().slice(0, 10), end: sunday.toISOString().slice(0, 10) };
}

const HR_ROLES  = ["hr_admin", "hr_officer", "super_admin"];
const ALL_ROLES = [...HR_ROLES, "manager"];
const LOCK_ROLES = ["hr_admin", "super_admin"];

async function assertPeriodsUnlocked(tenantId: string, dates: string[]): Promise<void> {
  const periods = Array.from(new Set(dates.map((d) => d.slice(0, 7))));
  const locked = await repo.findLockedPeriods(tenantId, periods);
  if (locked.length > 0) {
    throw new HttpError(
      422,
      "ATTENDANCE_LOCKED",
      `attendance period(s) ${locked.sort().join(", ")} are locked (payroll cut-off) — reopen the period before editing`,
    );
  }
}

// GAP-HR-SF-10 fix. This file used to scope/guard non-privileged ("employee")
// callers with raw `ctx.actorId` comparisons against hrms_employees-linked
// columns (employeeId). ctx.actorId is the JWT subject (the login/account
// id); hrms_employees.id is a separate id space linked via
// hrms_employees.user_ref -- see employee/actor-link.ts's
// resolveEmployeeForActor doc comment. The two never coincide, so every
// comparison below silently failed CLOSED (empty lists, spurious 403s on a
// caller's own records) -- broken self-service, not a leak, but it also left
// the "cannot approve your own request" guards on WFH/shift-requests
// permanently inert, which becomes a live self-approval hole for anyone
// holding both "manager" and "employee" roles the moment self-service starts
// working. Fixed by resolving through resolveEmployeeForActor, the same
// pattern already used by ~25 other modules in this service (apar,
// geo-attendance, medical, leave, self-service, etc.) -- see medical/
// routes.ts's resolveSelfScopedEmployeeId for the closest precedent to the
// two helpers below.

/**
 * Self-scoping for the list/read routes below (shift-requests, wfh-requests,
 * overtime-requests, checkin-log).
 *
 * SEC FIX (GAP-HR-SF-16 fold-in: SHIFT-REQUESTS-01 / WFH-02 / OVERTIME-03):
 * a "manager" caller used to be bundled with HR as fully privileged --
 * `requested` (or its absence) passed straight through with no ownership
 * check at all, so any manager could either omit empId to get every
 * employee's requests tenant-wide, or pass an arbitrary colleague's
 * employeeId (not even a direct report) and read their requests directly.
 * A manager is now scoped to their own linked employee id plus their direct
 * reports' -- never the full tenant, and never an id outside that set even
 * if explicitly requested (denied, not silently substituted).
 *
 * Returns:
 *   - `requested` unchanged (string | undefined) — HR: unscoped, unchanged.
 *   - `string[]`   — manager: the concrete [self, ...directReports] set,
 *     narrowed to `[requested]` when requested is inside it, or `[]` (deny)
 *     when it isn't.
 *   - the employee's own id, or `null` — bare "employee": UNCHANGED from
 *     before.
 */
async function resolveSelfScopedEmployeeId(
  ctx: RequestContext,
  requested: string | undefined,
): Promise<string | string[] | undefined | null> {
  const isHrActor = HR_ROLES.some((r) => ctx.roles.includes(r));
  if (isHrActor) return requested;
  if (ctx.roles.includes("manager")) {
    const actorEmp = await resolveEmployeeForActor(ctx.tenantId, ctx.actorId);
    if (!actorEmp) return [];
    const reports = await scopedRead((tx) => tx.select({ id: hrmsEmployees.id }).from(hrmsEmployees)
      .where(and(eq(hrmsEmployees.tenantId, ctx.tenantId), eq(hrmsEmployees.managerId, actorEmp.id))));
    const scope = [actorEmp.id, ...reports.map((r) => r.id)];
    if (requested) return scope.includes(requested) ? [requested] : [];
    return scope;
  }
  const actorEmp = await resolveEmployeeForActor(ctx.tenantId, ctx.actorId);
  return actorEmp ? actorEmp.id : null;
}

/**
 * IDOR guard for the *create* routes below. Deliberately NOT the same
 * privilege set as resolveSelfScopedEmployeeId above: a manager may VIEW the
 * full queue but (existing, unchanged behavior) may not submit a request on
 * someone else's behalf -- only HR can. Throws 403 unless the caller is HR
 * or claimedEmployeeId resolves to the caller's own linked hrms_employees
 * row.
 */
async function assertSelfOrHr(ctx: RequestContext, claimedEmployeeId: string, action: string): Promise<void> {
  const isHrActor = HR_ROLES.some((r) => ctx.roles.includes(r));
  if (isHrActor) return;
  const actorEmp = await resolveEmployeeForActor(ctx.tenantId, ctx.actorId);
  if (!actorEmp || claimedEmployeeId !== actorEmp.id) {
    throw new HttpError(403, "FORBIDDEN", `employees may only ${action} for themselves`);
  }
}

/**
 * GAP-HR-ATTENDANCE-REGULARISATION-01: who a regularisation request is FOR.
 *
 *  - HR (hr_admin/hr_officer/super_admin): on behalf of anyone; employeeId is
 *    required (there is no "self" default for an HR actor acting as HR).
 *  - manager: themselves or a DIRECT REPORT only (hrms_employees.manager_id),
 *    never an arbitrary colleague.
 *  - employee: themselves only. employeeId may be omitted (derived from the
 *    caller's linked employee record) but, if sent, must equal it.
 * An actor with no linked employee record cannot raise one for themselves.
 */
async function resolveRegularisationSubject(ctx: RequestContext, claimed: string | undefined): Promise<string> {
  if (HR_ROLES.some((r) => ctx.roles.includes(r))) {
    if (!claimed) throw new HttpError(400, "VALIDATION_FAILED", "employeeId is required when raising a regularisation on behalf of an employee");
    return claimed;
  }
  const actorEmp = await resolveEmployeeForActor(ctx.tenantId, ctx.actorId);
  if (!actorEmp) throw new HttpError(403, "FORBIDDEN", "no employee record is linked to your account");
  if (!claimed || claimed === actorEmp.id) return actorEmp.id;
  if (ctx.roles.includes("manager")) {
    const report = await scopedRead((tx) => tx.select({ id: hrmsEmployees.id }).from(hrmsEmployees)
      .where(and(eq(hrmsEmployees.tenantId, ctx.tenantId), eq(hrmsEmployees.id, claimed), eq(hrmsEmployees.managerId, actorEmp.id))).limit(1));
    if (report[0]) return claimed;
    throw new HttpError(403, "NOT_YOUR_REPORT", "you may only raise a regularisation for yourself or your own direct reports");
  }
  throw new HttpError(403, "FORBIDDEN", "employees may only raise a regularisation for themselves");
}

/**
 * Self-approval guard for the approve/reject routes below. ownerEmployeeId
 * (from the fetched request row) is already an hrms_employees.id; resolve
 * the approving actor's own linked row the same way before comparing -- an
 * actor with no linked employee row cannot BE the request's owner, so the
 * guard simply does not apply (returns false); it does not error.
 */
async function isSelfApproval(ctx: RequestContext, ownerEmployeeId: string): Promise<boolean> {
  const approverEmp = await resolveEmployeeForActor(ctx.tenantId, ctx.actorId);
  return !!approverEmp && ownerEmployeeId === approverEmp.id;
}

/**
 * Reporting-line guard for the WFH / shift-change approve/reject routes
 * below. Discovered, not in the original catalogue: resolveSelfScopedEmployeeId
 * already restricts the GET /wfh-requests and /shift-requests LIST queries so
 * a manager only ever sees self + direct reports (GAP-HR-SF-16 fold-in), but
 * the approve/reject routes next to those GETs only ever checked
 * isSelfApproval (cannot decide your OWN request) -- not whether the request
 * belongs to someone in the deciding manager's reporting line at all. A
 * manager could still approve or reject ANY other employee's pending WFH or
 * shift-change request tenant-wide, same shape as the GET-side leak
 * GAP-HR-SF-16 already fixed for the list views. HR is unaffected
 * (resolveSelfScopedEmployeeId returns `requested` unchanged for HR, which is
 * always non-empty here since ownerEmployeeId is a real row's id). Only HR
 * and manager roles ever reach these routes (role gate above), so this is
 * safe to call unconditionally.
 */
async function assertManagerOwnsReport(ctx: RequestContext, ownerEmployeeId: string, action: string): Promise<void> {
  const scope = await resolveSelfScopedEmployeeId(ctx, ownerEmployeeId);
  if (isEmptyScope(scope)) {
    throw new HttpError(403, "NOT_YOUR_REPORT", `you may only ${action} for your own direct reports`);
  }
}

/**
 * Maker != checker: now that an employee (or HR) can raise a regularisation
 * for themselves, the person deciding it must never be the person it is FOR.
 * Unconditional -- a conflict-of-interest guard, not a tenant policy.
 */
async function assertNotOwnRegularisation(ctx: RequestContext, regularisationId: string): Promise<void> {
  const rows = await scopedRead((tx) => tx.select({ employeeId: hrmsAttendanceRegularisations.employeeId })
    .from(hrmsAttendanceRegularisations)
    .where(and(eq(hrmsAttendanceRegularisations.id, regularisationId), eq(hrmsAttendanceRegularisations.tenantId, ctx.tenantId))).limit(1));
  const owner = rows[0]?.employeeId;
  if (owner && (await isSelfApproval(ctx, owner))) {
    throw new HttpError(403, "SELF_APPROVAL_FORBIDDEN", "you cannot decide your own regularisation request");
  }
}

export async function attendanceRoutes(app: FastifyInstance): Promise<void> {
  app.post("/v1/hrms/attendance", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, HR_ROLES);
    const body = markAttendanceBody.parse(req.body);
    await assertPeriodsUnlocked(ctx.tenantId, body.records.map((r) => r.attendanceDate));
    return sendAccepted(reply, acceptedResponseSchema, await commands.markAttendance(ctx, body));
  });

  app.get("/v1/hrms/attendance/locks", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, ALL_ROLES);
    return reply.send({ data: await queries.listAttendanceLocks(ctx.tenantId) });
  });

  app.post("/v1/hrms/attendance/locks", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, LOCK_ROLES);
    const body = periodLockBody.parse(req.body);
    return sendAccepted(reply, acceptedResponseSchema, await commands.lockPeriod(ctx, body));
  });

  app.post("/v1/hrms/attendance/locks/unlock", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, LOCK_ROLES);
    const body = periodLockBody.parse(req.body);
    return sendAccepted(reply, acceptedResponseSchema, await commands.unlockPeriod(ctx, body));
  });

  app.get("/v1/hrms/attendance/summary", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, ALL_ROLES);
    const q = z.object({ month: z.string().regex(/^\d{4}-\d{2}$/).default(new Date().toISOString().slice(0, 7)) }).parse(req.query);
    sendValidated(reply, attendanceSummaryResponseSchema, {
      data: await queries.getAttendanceSummaryForMonth(ctx.tenantId, q.month),
    });
  });

  app.get("/v1/hrms/attendance", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, ALL_ROLES);
    const q = listQuerySchema.extend({
      empId: z.string().uuid().optional(),
      month: z.string().regex(/^\d{4}-\d{2}$/).optional(),
    }).parse(req.query);
    if (q.empId && q.month) {
      return reply.send(await queries.getAttendanceByEmpAndMonth(ctx.tenantId, q.empId, q.month));
    }
    sendValidated(reply, AttendanceSummaryListSchema, await queries.listAttendance(ctx.tenantId, q.limit));
  });

  app.get("/v1/hrms/attendance/checkin-log", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, ALL_ROLES);
    const q = z.object({
      limit: z.coerce.number().int().min(1).max(500).default(200),
      offset: z.coerce.number().int().min(0).default(0),
    }).parse(req.query);
    // IDOR fix (GAP-HR-SF-16 fold-in): this route had ZERO employee scoping
    // -- any manager (ALL_ROLES here is HR+manager only; no bare "employee"
    // reaches this route) got the full tenant's checkin log, not just their
    // own team's. Mirrors GET /v1/hrms/shift-requests' scoping above; HR
    // keeps the full tenant view (unchanged).
    const scope = await resolveSelfScopedEmployeeId(ctx, undefined);
    if (isEmptyScope(scope)) return reply.send({ data: [] });
    const employeeIds = Array.isArray(scope) ? scope : scope ? [scope] : undefined;
    // GAP-HR-CHECKIN-LOG-02 (display half): the scoping/IDOR half of this gap
    // was already closed above by resolveSelfScopedEmployeeId (GAP-HR-SF-16);
    // what remained was repo.listCheckinLog returning a raw 8-char employeeId
    // slice and a permanently blank department, with no employee/department
    // join (unlike queries.listAttendance). queries.listCheckinLog (new)
    // resolves both via the shared batchEmployees/batchDepartments helpers,
    // the established pattern for new call sites in this module (see
    // GAP-HR-OVERTIME-02's GET /overtime-requests just below).
    return reply.send({ data: await queries.listCheckinLog(ctx.tenantId, q.limit, employeeIds, q.offset) });
  });

  app.get("/v1/hrms/attendance/regularisations", async (req, reply) => {
    const ctx = resolveContext(req);
    // GAP-HR-ATTENDANCE-REGULARISATION-01: employees can raise their own
    // requests now, so they must be able to see them -- scoped to their own
    // rows. A manager is scoped to self + direct reports (same scope the
    // sibling shift/WFH/overtime lists already apply); HR sees the full queue.
    requireRole(ctx, [...ALL_ROLES, "employee"]);
    const q = listQuerySchema.parse(req.query);
    const scope = await resolveSelfScopedEmployeeId(ctx, undefined);
    if (isEmptyScope(scope)) return sendValidated(reply, AttendanceRegularisationListSchema, []);
    // Scope goes into the SQL WHERE (before limit), not a post-filter.
    const ids = scope === undefined ? undefined : scope === null ? [] : Array.isArray(scope) ? scope : [scope];
    sendValidated(reply, AttendanceRegularisationListSchema, await queries.listRegularisations(ctx.tenantId, q.limit, ids));
  });

  app.post("/v1/hrms/attendance/regularisations", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, [...ALL_ROLES, "employee"]);
    const parsed = regularisationCreateBody.parse(req.body);
    // Period lock first: it depends only on the date, not on who the request is for.
    await assertPeriodsUnlocked(ctx.tenantId, [parsed.date]);
    const body: ResolvedRegularisationBody = { ...parsed, employeeId: await resolveRegularisationSubject(ctx, parsed.employeeId) };
    // HIGH fix: repo.insertRegularisation (consumer.ts) was a blind insert with
    // no check that a raw attendance record exists for this employee+date -- a
    // regularisation is meant to correct attendance that was actually marked,
    // not fabricate a record for a day nothing was ever marked on. Synchronous
    // pre-check, the same "fail fast with a clear error instead of a false 202
    // that silently no-ops downstream" pattern already used by
    // assertPeriodsUnlocked just above and by leave/commands.ts's
    // approveLeave/rejectLeave transition checks -- the async consumer has no
    // channel left to signal a rejection back to the caller once it has
    // already replied 202.
    const attendanceRecord = await repo.findAttendanceByEmpAndDate(ctx.tenantId, body.employeeId, body.date);
    if (!attendanceRecord) {
      throw new HttpError(
        404,
        "ATTENDANCE_RECORD_NOT_FOUND",
        `no attendance record exists for employee ${body.employeeId} on ${body.date} -- mark attendance before requesting a regularisation`,
      );
    }
    return sendAccepted(reply, acceptedResponseSchema, await commands.createRegularisation(ctx, body));
  });

  // PPL-D1 fix: approve / reject a pending regularisation
  app.post("/v1/hrms/attendance/regularisations/:id/approve", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, HR_ROLES);
    const { id } = z.object({ id: z.string().uuid() }).parse(req.params);
    z.object({ reason: z.string().max(500).optional() }).parse(req.body ?? {});

    // Synchronous pre-check: the old code atomically updated WHERE status='pending'
    // and 404'd when the regularisation was missing or already decided. The async
    // consumer applies the same guarded update, but that check must also run here —
    // otherwise an invalid/duplicate approve would get a false-positive 202 while
    // the write is silently skipped.
    const existing = await scopedRead((tx) =>
      tx.select({ id: hrmsAttendanceRegularisations.id, status: hrmsAttendanceRegularisations.status })
        .from(hrmsAttendanceRegularisations)
        .where(and(eq(hrmsAttendanceRegularisations.id, id), eq(hrmsAttendanceRegularisations.tenantId, ctx.tenantId)))
        .limit(1),
    );
    if (!existing[0] || existing[0].status !== "pending") {
      throw new HttpError(404, "NOT_FOUND", "regularisation not found or already decided");
    }
    await assertNotOwnRegularisation(ctx, id);

    await publishF3Write(ctx, "attendance_routes__0", id, { body: (req.body as Record<string, unknown>) ?? {}, params: req.params as Record<string, unknown>, query: req.query as Record<string, unknown> });
    return reply.code(202).send({ id, status: "approved" }) as any;
  });

  app.post("/v1/hrms/attendance/regularisations/:id/reject", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, HR_ROLES);
    const { id } = z.object({ id: z.string().uuid() }).parse(req.params);
    z.object({ reason: z.string().min(1).max(500) }).parse(req.body ?? {});

    // Synchronous pre-check — same reasoning as the approve route above: mirror
    // the consumer's WHERE status='pending' guard so a bad/duplicate reject 404s
    // synchronously instead of silently no-op'ing after a false 202.
    const existing = await scopedRead((tx) =>
      tx.select({ id: hrmsAttendanceRegularisations.id, status: hrmsAttendanceRegularisations.status })
        .from(hrmsAttendanceRegularisations)
        .where(and(eq(hrmsAttendanceRegularisations.id, id), eq(hrmsAttendanceRegularisations.tenantId, ctx.tenantId)))
        .limit(1),
    );
    if (!existing[0] || existing[0].status !== "pending") {
      throw new HttpError(404, "NOT_FOUND", "regularisation not found or already decided");
    }
    await assertNotOwnRegularisation(ctx, id);

    await publishF3Write(ctx, "attendance_routes__1", id, { body: (req.body as Record<string, unknown>) ?? {}, params: req.params as Record<string, unknown>, query: req.query as Record<string, unknown> });
    return reply.code(202).send({ id, status: "rejected" }) as any;
  });

  // Shifts list (hrmsShifts table)
  app.get("/v1/hrms/shifts", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, ALL_ROLES);
    return reply.send({ data: await repo.listShifts(ctx.tenantId) });
  });

  app.get("/v1/hrms/shift-requests", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, [...HR_ROLES, "manager", "employee"]);
    const q = z.object({ empId: z.string().uuid().optional() }).parse(req.query);
    // Self-service (WAVE-4): employees may only list their own shift-change
    // requests; HR/manager keep the full tenant queue or an empId filter.
    // Mirrors GET /v1/hrms/overtime-requests' IDOR guard below.
    const effectiveEmpId = await resolveSelfScopedEmployeeId(ctx, q.empId);
    if (isEmptyScope(effectiveEmpId)) {
      return reply.send({ data: [] });
    }
    // SEC-010: attendance.hrms_shift_change_requests is now FORCE RLS'd. A
    // bare db.select() runs with no app.tenant_id GUC set, which would fail
    // closed to zero rows for every tenant (see shared/db.ts's scopedRead
    // doc comment) — read inside the tenant transaction instead.
    const rows = await scopedRead((tx) =>
      tx.select().from(hrmsShiftChangeRequests)
        .where(and(
          eq(hrmsShiftChangeRequests.tenantId, ctx.tenantId),
          employeeScopeCondition(hrmsShiftChangeRequests.employeeId, effectiveEmpId),
        ))
        .orderBy(desc(hrmsShiftChangeRequests.createdAt))
        .limit(200),
    );
    const employees = await employeeRepo.listByTenant(ctx.tenantId, 500, 0);
    const empMap = new Map(employees.map((e) => [e.id, e]));
    return reply.send({ data: rows.map((r) => ({
      id: r.id,
      employeeId: r.employeeId,
      employeeName: empMap.get(r.employeeId)?.fullName ?? r.employeeId.slice(0, 8),
      currentShift: r.currentShift,
      requestedShift: r.requestedShift,
      effectiveDate: r.effectiveDate,
      reason: r.reason ?? null,
      status: r.status,
      createdAt: r.createdAt instanceof Date ? r.createdAt.toISOString() : String(r.createdAt),
    })) });
  });

  app.get("/v1/hrms/wfh-requests", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, [...HR_ROLES, "manager", "employee"]);
    const q = z.object({ empId: z.string().uuid().optional() }).parse(req.query);
    // Self-service (WAVE-4): employees may only list their own WFH requests;
    // HR/manager keep the full tenant queue or an empId filter. Mirrors
    // GET /v1/hrms/overtime-requests' IDOR guard below.
    const effectiveEmpId = await resolveSelfScopedEmployeeId(ctx, q.empId);
    if (isEmptyScope(effectiveEmpId)) {
      return reply.send({ data: [] });
    }
    // SEC-010: attendance.hrms_wfh_requests is now FORCE RLS'd — same reasoning
    // as GET /v1/hrms/shift-requests above.
    const rows = await scopedRead((tx) =>
      tx.select().from(hrmsWfhRequests)
        .where(and(
          eq(hrmsWfhRequests.tenantId, ctx.tenantId),
          employeeScopeCondition(hrmsWfhRequests.employeeId, effectiveEmpId),
        ))
        .orderBy(desc(hrmsWfhRequests.createdAt))
        .limit(200),
    );
    const employees = await employeeRepo.listByTenant(ctx.tenantId, 500, 0);
    const empMap = new Map(employees.map((e) => [e.id, e]));
    return reply.send({ data: rows.map((r) => ({
      id: r.id,
      employeeId: r.employeeId,
      employeeName: empMap.get(r.employeeId)?.fullName ?? r.employeeId.slice(0, 8),
      fromDate: r.fromDate,
      toDate: r.toDate,
      reason: r.reason ?? null,
      status: r.status,
      // GAP-HR-WFH-04: was silently dropped from this mapping even though
      // f3-consumer.ts's attendance_routes__7 already persists it on reject
      // -- the requester had no way to ever see why their request was
      // rejected.
      rejectionReason: r.rejectionReason ?? null,
      createdAt: r.createdAt instanceof Date ? r.createdAt.toISOString() : String(r.createdAt),
    })) });
  });

  // ── Overtime requests ───────────────────────────────────────────────────
  app.post("/v1/hrms/overtime-requests", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, [...HR_ROLES, "employee"]);
    const body = z.object({
      employeeId:     z.string().uuid(),
      requestDate:    z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
      hoursRequested: z.number().min(0.5).max(24),
      reason:         z.string().max(500).optional(),
    }).parse(req.body);
    // IDOR guard: employees may only submit OT requests for themselves
    await assertSelfOrHr(ctx, body.employeeId, "create overtime requests");

    // GAP-HR-OVERTIME-NEW-04: overtime is logged for hours already worked,
    // not planned in advance -- a future-dated request has no legitimate
    // reading. Coarse (UTC calendar-day) comparison, not IST-precise: this
    // is a conservative "don't let this slip through" guard, not a
    // display-facing date computation (see GAP-HR-ADVANCES-06's own note on
    // why the shared IST-aware date helper itself is left to open PR #1653
    // / GAP-HR-SF-07 rather than duplicated here).
    const todayUtc = new Date().toISOString().slice(0, 10);
    if (body.requestDate > todayUtc) {
      throw new HttpError(422, "FUTURE_DATE_NOT_ALLOWED", "overtime cannot be requested for a future date");
    }

    // GAP-HR-OVERTIME-NEW-04: reject a second pending/approved request for
    // the same employee+date instead of silently allowing duplicates (a
    // rejected prior request for the same day is not a duplicate -- the
    // employee is entitled to re-request).
    const dup = await scopedRead((tx) => tx.select({ id: hrmsOvertimeRequests.id }).from(hrmsOvertimeRequests)
      .where(and(
        eq(hrmsOvertimeRequests.tenantId, ctx.tenantId),
        eq(hrmsOvertimeRequests.employeeId, body.employeeId),
        eq(hrmsOvertimeRequests.requestDate, body.requestDate),
        inArray(hrmsOvertimeRequests.status, ["pending", "approved"]),
      ))
      .limit(1));
    if (dup.length > 0) {
      throw new HttpError(409, "DUPLICATE_REQUEST", "an overtime request already exists for this employee on this date");
    }

    const id = randomUUID();
    await publishF3Write(ctx, "attendance_routes__2", id, { body: (req.body as Record<string, unknown>) ?? {}, params: req.params as Record<string, unknown>, query: req.query as Record<string, unknown> });
    return reply.code(202).send({ id, status: "pending" }) as any;
  });

  app.get("/v1/hrms/overtime-requests", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, [...HR_ROLES, "employee", "manager"]);
    const q = z.object({
      empId: z.string().uuid().optional(),
      // GAP-HR-OVERTIME-04: the manager-scope half of this gap (a manager
      // seeing every employee's overtime, not just direct reports) was
      // already closed by resolveSelfScopedEmployeeId below (same shared fix
      // as GET /wfh-requests and /shift-requests). What remained was the
      // silent `.limit(200)` truncation with no hasMore/total signal, so a
      // tenant with >200 rows had its stat cards computed from an
      // incomplete, arbitrarily-ordered window with no indication anything
      // was missing.
      limit: z.coerce.number().int().min(1).max(200).default(200),
      offset: z.coerce.number().int().min(0).default(0),
    }).parse(req.query);
    // IDOR guard: employees may only read their own OT requests
    const effectiveEmpId = await resolveSelfScopedEmployeeId(ctx, q.empId);
    if (isEmptyScope(effectiveEmpId)) {
      return reply.send({ data: [], hasMore: false, total: 0 });
    }
    // FORCE-RLS fix: was a bare db.select() against attendance.hrms_overtime_requests
    // (FORCE ROW LEVEL SECURITY — migration 0148), so under the NOBYPASSRLS
    // hrms_svc role no app.tenant_id GUC was ever set and the fail-closed
    // policy silently returned zero rows regardless of real data — an
    // employee's/manager's/HR's OT list always looked empty. scopedRead is
    // already used a few lines below (the approve route) for exactly this
    // table; mirror it here.
    const whereCond = and(
      eq(hrmsOvertimeRequests.tenantId, ctx.tenantId),
      employeeScopeCondition(hrmsOvertimeRequests.employeeId, effectiveEmpId),
    );
    const [rows, totalResult] = await scopedRead(async (tx) => [
      await tx.select().from(hrmsOvertimeRequests)
        .where(whereCond)
        .orderBy(desc(hrmsOvertimeRequests.requestDate))
        .limit(q.limit + 1)
        .offset(q.offset),
      await tx.select({ value: count() }).from(hrmsOvertimeRequests).where(whereCond),
    ]);
    const hasMore = rows.length > q.limit;
    const page = hasMore ? rows.slice(0, q.limit) : rows;
    // GAP-HR-OVERTIME-02: resolve employeeName/employeeNo via the shared
    // batch-resolution helper (same building block GAP-HR-ADVANCES-01/
    // GAP-HR-LOANS-01 already adopted) instead of the web layer showing the
    // raw employeeId.
    const empMap = await batchEmployees(ctx.tenantId, page.map((r) => r.employeeId));
    return reply.send({
      data: page.map((r) => ({
        ...r,
        employeeName: empMap.get(r.employeeId)?.fullName,
        employeeNo: empMap.get(r.employeeId)?.employeeNo,
      })),
      hasMore,
      total: totalResult[0]?.value ?? 0,
    });
  });

  app.patch("/v1/hrms/overtime-requests/:id/approve", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, HR_ROLES);
    const { id } = z.object({ id: z.string().uuid() }).parse(req.params);

    // Synchronous pre-check (existence + status): the old code only checked
    // existence, so a conditional UPDATE WHERE id+tenantId 404'd on an
    // invalid id but happily re-approved/re-rejected an already-decided
    // request -- illegal state reversal (approve an already-rejected
    // request or vice versa) with no error at all. Mirror the
    // regularisation approve/reject guard just above: also require
    // status='pending' here, and let the async consumer's
    // repo.updateOvertimeStatus apply the same guard atomically as part of
    // the write itself (see f3-consumer.ts's attendance_routes__3).
    const existing = await scopedRead((tx) =>
      tx.select({ id: hrmsOvertimeRequests.id, status: hrmsOvertimeRequests.status, employeeId: hrmsOvertimeRequests.employeeId }).from(hrmsOvertimeRequests)
        .where(and(eq(hrmsOvertimeRequests.id, id), eq(hrmsOvertimeRequests.tenantId, ctx.tenantId)))
        .limit(1),
    );
    if (!existing[0] || existing[0].status !== "pending") {
      return reply.code(404).send({ error: "Overtime request not found or already decided" });
    }
    // GAP-HR-OVERTIME-01 (risk note: "must not allow the requester to
    // approve their own request" -- HR_ROLES alone doesn't prevent an
    // hr_admin who also filed for themselves via assertSelfOrHr's isHrActor
    // branch above). Reuses the isSelfApproval helper already defined in
    // this file for the WFH approve route below.
    if (await isSelfApproval(ctx, existing[0].employeeId)) {
      throw new HttpError(403, "FORBIDDEN", "you may not approve an overtime request you created yourself");
    }

    await publishF3Write(ctx, "attendance_routes__3", id, { body: (req.body as Record<string, unknown>) ?? {}, params: req.params as Record<string, unknown>, query: req.query as Record<string, unknown> });
    return reply.code(202).send({ id, status: "approved" }) as any;
  });

  app.patch("/v1/hrms/overtime-requests/:id/reject", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, HR_ROLES);
    const { id } = z.object({ id: z.string().uuid() }).parse(req.params);
    z.object({ reason: z.string().max(500).optional() }).parse(req.body);

    // Synchronous pre-check (existence + status) — same reasoning as the
    // approve route above: a decided request (approved or rejected) must
    // not be re-decided in the other direction.
    const existing = await scopedRead((tx) =>
      tx.select({ id: hrmsOvertimeRequests.id, status: hrmsOvertimeRequests.status, employeeId: hrmsOvertimeRequests.employeeId }).from(hrmsOvertimeRequests)
        .where(and(eq(hrmsOvertimeRequests.id, id), eq(hrmsOvertimeRequests.tenantId, ctx.tenantId)))
        .limit(1),
    );
    if (!existing[0] || existing[0].status !== "pending") {
      return reply.code(404).send({ error: "Overtime request not found or already decided" });
    }
    // GAP-HR-OVERTIME-01: same self-decision guard as approve above.
    if (await isSelfApproval(ctx, existing[0].employeeId)) {
      throw new HttpError(403, "FORBIDDEN", "you may not reject an overtime request you created yourself");
    }

    await publishF3Write(ctx, "attendance_routes__4", id, { body: (req.body as Record<string, unknown>) ?? {}, params: req.params as Record<string, unknown>, query: req.query as Record<string, unknown> });
    return reply.code(202).send({ id, status: "rejected" }) as any;
  });

  // ── WFH (Work From Home) requests ───────────────────────────────────────
  // WAVE-4 gap closure: the workforce/wfh frontend page (WFHRequestForm)
  // already POSTs to /v1/hrms/wfh-requests -- { employeeId, fromDate, toDate,
  // reason } -- and GET /v1/hrms/wfh-requests already existed (above), but no
  // create/approve/reject route existed at all, so every submission 404'd.
  // Mirrors the overtime-requests create/approve/reject routes just above
  // (same F3 async-write + 202 Accepted shape, same self-only IDOR guard on
  // create), with two deliberate corrections rather than copying those
  // routes' gaps forward:
  //  1. approve/reject re-check status==='pending' (mirroring the
  //     regularisation routes' guard further up this file), not just
  //     existence -- overtime's approve/reject only check existence, so an
  //     already-decided OT request can currently be silently re-decided.
  //  2. approve/reject also reject the actor deciding their own request --
  //     no existing precedent in this module checks that at all.
  app.post("/v1/hrms/wfh-requests", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, [...HR_ROLES, "employee"]);
    const body = z.object({
      employeeId: z.string().uuid(),
      fromDate:   z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
      toDate:     z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
      reason:     z.string().max(500).optional(),
    }).refine((d) => d.toDate >= d.fromDate, {
      message: "toDate must be on or after fromDate", path: ["toDate"],
    }).parse(req.body);
    // IDOR guard: employees may only submit WFH requests for themselves.
    await assertSelfOrHr(ctx, body.employeeId, "create WFH requests");

    // GAP-HR-WFH-01 (partial — weekly cap only). DoPT OM 2022 caps WFH at 2
    // days/week; the OTHER half of this gap (reject gazetted/Level>10 staff
    // outright) is deliberately NOT enforced here and left open: neither
    // hrms_employees nor hrms_designations exposes a column confirmed to be
    // the GoI pay-matrix level this policy means (designations only has
    // `level`/`payGrade`, whose mapping to it was never verified against a
    // real data source — see this gap's catalogue entry) — guessing wrong
    // would wrongly block or allow employees, which is worse than leaving it
    // open. The weekly cap below is safe to enforce regardless: it only ever
    // adds a restriction, never grants the gazetted exemption this doesn't
    // check. Coarse Mon-Sun UTC week boundary (not IST-precise) — same
    // "don't let this slip through" philosophy already used by the overtime
    // future-date guard above, not a display-facing date computation.
    const { start: weekStart, end: weekEnd } = isoWeekBoundsUtc(body.fromDate);
    const sameWeek = await scopedRead((tx) => tx.select({ id: hrmsWfhRequests.id }).from(hrmsWfhRequests)
      .where(and(
        eq(hrmsWfhRequests.tenantId, ctx.tenantId),
        eq(hrmsWfhRequests.employeeId, body.employeeId),
        inArray(hrmsWfhRequests.status, ["pending", "approved"]),
        gte(hrmsWfhRequests.fromDate, weekStart),
        lte(hrmsWfhRequests.fromDate, weekEnd),
      )));
    if (sameWeek.length >= 2) {
      throw new HttpError(422, "WEEKLY_WFH_CAP_REACHED", "the 2-day-per-week WFH limit (DoPT OM 2022) is already reached for this week");
    }

    const id = randomUUID();
    await publishF3Write(ctx, "attendance_routes__5", id, { body: (req.body as Record<string, unknown>) ?? {}, params: req.params as Record<string, unknown>, query: req.query as Record<string, unknown> });
    return reply.code(202).send({ id, status: "pending" }) as any;
  });

  app.patch("/v1/hrms/wfh-requests/:id/approve", async (req, reply) => {
    const ctx = resolveContext(req);
    // Managers decide their reports' WFH requests, same as the existing GET
    // above already lets them view the full queue -- unlike overtime, which
    // is HR-only.
    requireRole(ctx, [...HR_ROLES, "manager"]);
    const { id } = z.object({ id: z.string().uuid() }).parse(req.params);

    const existing = await scopedRead((tx) =>
      tx.select({ id: hrmsWfhRequests.id, employeeId: hrmsWfhRequests.employeeId, status: hrmsWfhRequests.status })
        .from(hrmsWfhRequests)
        .where(and(eq(hrmsWfhRequests.id, id), eq(hrmsWfhRequests.tenantId, ctx.tenantId)))
        .limit(1),
    );
    if (!existing[0]) {
      throw new HttpError(404, "NOT_FOUND", "WFH request not found");
    }
    if (await isSelfApproval(ctx, existing[0].employeeId)) {
      throw new HttpError(403, "FORBIDDEN", "you cannot approve or reject your own WFH request");
    }
    // GAP-HR-WFH-03 (approve/reject half — discovered, not in the original
    // catalogue entry; the GET-side manager scope was already fixed). See
    // assertManagerOwnsReport's doc comment.
    await assertManagerOwnsReport(ctx, existing[0].employeeId, "approve or reject WFH requests");
    if (existing[0].status !== "pending") {
      throw new HttpError(404, "NOT_FOUND", "WFH request not found or already decided");
    }

    await publishF3Write(ctx, "attendance_routes__6", id, { body: (req.body as Record<string, unknown>) ?? {}, params: req.params as Record<string, unknown>, query: req.query as Record<string, unknown> });
    return reply.code(202).send({ id, status: "approved" }) as any;
  });

  app.patch("/v1/hrms/wfh-requests/:id/reject", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, [...HR_ROLES, "manager"]);
    const { id } = z.object({ id: z.string().uuid() }).parse(req.params);
    z.object({ reason: z.string().max(500).optional() }).parse(req.body ?? {});

    const existing = await scopedRead((tx) =>
      tx.select({ id: hrmsWfhRequests.id, employeeId: hrmsWfhRequests.employeeId, status: hrmsWfhRequests.status })
        .from(hrmsWfhRequests)
        .where(and(eq(hrmsWfhRequests.id, id), eq(hrmsWfhRequests.tenantId, ctx.tenantId)))
        .limit(1),
    );
    if (!existing[0]) {
      throw new HttpError(404, "NOT_FOUND", "WFH request not found");
    }
    if (await isSelfApproval(ctx, existing[0].employeeId)) {
      throw new HttpError(403, "FORBIDDEN", "you cannot approve or reject your own WFH request");
    }
    // GAP-HR-WFH-03 (approve/reject half) — see assertManagerOwnsReport's doc comment.
    await assertManagerOwnsReport(ctx, existing[0].employeeId, "approve or reject WFH requests");
    if (existing[0].status !== "pending") {
      throw new HttpError(404, "NOT_FOUND", "WFH request not found or already decided");
    }

    await publishF3Write(ctx, "attendance_routes__7", id, { body: (req.body as Record<string, unknown>) ?? {}, params: req.params as Record<string, unknown>, query: req.query as Record<string, unknown> });
    return reply.code(202).send({ id, status: "rejected" }) as any;
  });

  // ── Shift-change requests ────────────────────────────────────────────────
  // WAVE-4 gap closure: GET /v1/hrms/shift-requests already existed (above)
  // and the shift-requests frontend page already describes a "submit ->
  // supervisor approves" maker-checker workflow, but as of this fix that page
  // is READ-ONLY (a list + stat cards, no submit form and no approve/reject
  // controls anywhere in apps/web) -- there is no frontend fetch call to
  // confirm a create contract against. The body shape below is inferred from
  // the fields the existing GET route already returns (currentShift,
  // requestedShift, effectiveDate, reason -- see above), since those are the
  // only concretely-established field names for this entity. See this PR's
  // description: the frontend still needs its own create form + an
  // approve/reject action added to actually reach these routes.
  app.post("/v1/hrms/shift-requests", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, [...HR_ROLES, "employee"]);
    const body = z.object({
      employeeId:     z.string().uuid(),
      currentShift:   z.string().min(1).max(120),
      requestedShift: z.string().min(1).max(120),
      effectiveDate:  z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
      reason:         z.string().max(500).optional(),
    }).parse(req.body);
    // IDOR guard: employees may only submit shift-change requests for
    // themselves.
    await assertSelfOrHr(ctx, body.employeeId, "create shift-change requests");
    const id = randomUUID();
    await publishF3Write(ctx, "attendance_routes__8", id, { body: (req.body as Record<string, unknown>) ?? {}, params: req.params as Record<string, unknown>, query: req.query as Record<string, unknown> });
    return reply.code(202).send({ id, status: "pending" }) as any;
  });

  app.patch("/v1/hrms/shift-requests/:id/approve", async (req, reply) => {
    const ctx = resolveContext(req);
    // Managers decide their reports' shift-change requests, same as the
    // existing GET above already lets them view the full queue -- unlike
    // overtime, which is HR-only.
    requireRole(ctx, [...HR_ROLES, "manager"]);
    const { id } = z.object({ id: z.string().uuid() }).parse(req.params);

    const existing = await scopedRead((tx) =>
      tx.select({ id: hrmsShiftChangeRequests.id, employeeId: hrmsShiftChangeRequests.employeeId, status: hrmsShiftChangeRequests.status })
        .from(hrmsShiftChangeRequests)
        .where(and(eq(hrmsShiftChangeRequests.id, id), eq(hrmsShiftChangeRequests.tenantId, ctx.tenantId)))
        .limit(1),
    );
    if (!existing[0]) {
      throw new HttpError(404, "NOT_FOUND", "shift-change request not found");
    }
    if (await isSelfApproval(ctx, existing[0].employeeId)) {
      throw new HttpError(403, "FORBIDDEN", "you cannot approve or reject your own shift-change request");
    }
    // Discovered, not in the original catalogue — see assertManagerOwnsReport's doc comment.
    await assertManagerOwnsReport(ctx, existing[0].employeeId, "approve or reject shift-change requests");
    if (existing[0].status !== "pending") {
      throw new HttpError(404, "NOT_FOUND", "shift-change request not found or already decided");
    }

    await publishF3Write(ctx, "attendance_routes__9", id, { body: (req.body as Record<string, unknown>) ?? {}, params: req.params as Record<string, unknown>, query: req.query as Record<string, unknown> });
    return reply.code(202).send({ id, status: "approved" }) as any;
  });

  app.patch("/v1/hrms/shift-requests/:id/reject", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, [...HR_ROLES, "manager"]);
    const { id } = z.object({ id: z.string().uuid() }).parse(req.params);
    z.object({ reason: z.string().max(500).optional() }).parse(req.body ?? {});

    const existing = await scopedRead((tx) =>
      tx.select({ id: hrmsShiftChangeRequests.id, employeeId: hrmsShiftChangeRequests.employeeId, status: hrmsShiftChangeRequests.status })
        .from(hrmsShiftChangeRequests)
        .where(and(eq(hrmsShiftChangeRequests.id, id), eq(hrmsShiftChangeRequests.tenantId, ctx.tenantId)))
        .limit(1),
    );
    if (!existing[0]) {
      throw new HttpError(404, "NOT_FOUND", "shift-change request not found");
    }
    if (await isSelfApproval(ctx, existing[0].employeeId)) {
      throw new HttpError(403, "FORBIDDEN", "you cannot approve or reject your own shift-change request");
    }
    // Discovered, not in the original catalogue — see assertManagerOwnsReport's doc comment.
    await assertManagerOwnsReport(ctx, existing[0].employeeId, "approve or reject shift-change requests");
    if (existing[0].status !== "pending") {
      throw new HttpError(404, "NOT_FOUND", "shift-change request not found or already decided");
    }

    await publishF3Write(ctx, "attendance_routes__10", id, { body: (req.body as Record<string, unknown>) ?? {}, params: req.params as Record<string, unknown>, query: req.query as Record<string, unknown> });
    return reply.code(202).send({ id, status: "rejected" }) as any;
  });

  app.setErrorHandler(errorHandler);
}

function errorHandler(err: unknown, req: any, reply: any): void {
  const correlationId = (req.headers["x-correlation-id"] as string) ?? req.id;
  if (err instanceof ZodError) {
    void reply.code(400).send({ code: "VALIDATION_FAILED", message: "invalid request", correlationId, retryable: false, fieldErrors: err.issues.map((i) => ({ field: i.path.join("."), message: i.message })) });
    return;
  }
  if (err instanceof HttpError) {
    void reply.code(err.status).send({ code: err.code, message: err.message, correlationId, retryable: false });
    return;
  }
  req.log.error({ err }, "unhandled error");
  void reply.code(500).send({ code: "INTERNAL", message: "internal error", correlationId, retryable: true });
}
