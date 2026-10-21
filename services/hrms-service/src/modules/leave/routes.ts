import type { FastifyInstance, FastifyRequest } from "fastify";
import type { RequestContext } from "@civitasone/types";
import { ZodError, z } from "zod";
import { listQuerySchema, acceptedResponseSchema } from "@civitasone/schemas/common";
import { leaveListResponseSchema, LeaveRequestDetailListSchema, LeaveRequestPageSchema } from "@civitasone/schemas/web";
import {sendValidated, sendAccepted } from "@civitasone/schemas/validate";
import { and, eq } from "drizzle-orm";
import { resolveContext, requireRole, requirePermissionKey, HttpError } from "../../shared/context.js";
import { scopedRead} from "../../shared/db.js";
import { hrmsEmployees } from "../employee/schema.js";
import { resolveEmployeeForActor } from "../employee/actor-link.js";
import { resolveLeaveReadScope } from "../../shared/self-scope.js";
import { createLeaveTypeBody, allocateLeaveBody, applyLeaveBody, idParam, rejectLeaveBody, leaveTenantConfigBody } from "./validators.js";
import { validateLeaveRequest, LEAVE_POLICIES, type EmployeeType, type LeaveCategory } from "./rules-engine.js";
import { loadTypeResolver, leaveEligible } from "../employee/engagement-policy.js";
import * as repo from "./repo.js";
import * as commands from "./commands.js";
import * as queries from "./queries.js";
import { fetchOpenTaskRefIds } from "../../shared/workflow-client.js";
import { assertDayPartAllowed, assertSufficientLeaveBalance, blockingOverlaps, effectiveBalanceDays, DomainError } from "./domain.js";

const HR_ROLES  = ["hr_admin", "hr_officer", "super_admin"];
const ALL_ROLES = [...HR_ROLES, "manager", "employee"];
// Mirrors policy-admin-routes.ts HR_ADMIN_ROLES: leave-entitlement policy is an HR-admin call.
const LEAVE_CONFIG_ADMIN_ROLES = ["hr_admin", "super_admin", "tenant_admin", "platform_admin"];


/** One reason a leave application cannot be accepted (what a submit answers with 422). */
interface LeaveViolation {
  code: string;
  message: string;
}

/**
 * The outcome of running every synchronous leave rule against an application,
 * without publishing anything. GAP-HR-LEAVE-APPLY-01: this is the ONE code
 * path both POST /leave-requests (submit) and POST /leave-requests/preview
 * run, so what the applicant is shown can never diverge from what is debited.
 */
interface LeaveEvaluation {
  /**
   * The CCS rules engine's holiday/sandwich/prefix-suffix-aware day count when
   * the engine ran, or null when the leave code is outside the engine (EOL/MED
   * ...) -- callers then keep the client-submitted daysApplied. Still set
   * (to what the engine computed) when `violations` is non-empty, so a preview
   * can show what the request would have cost.
   */
  computedDays: number | null;
  /** Non-blocking engine notices (sandwich / prefix-suffix applied, accumulation lapse). */
  warnings: string[];
  /** Blocking reasons; empty means the application is acceptable. */
  violations: LeaveViolation[];
  /** Holiday dates (tenant calendar) inside the requested range. */
  holidaysInRange: string[];
  /** The allocation balance the request is checked against (0.5 granularity). */
  balance: number;
}

/**
 * Run the CCS(Leave) rules synchronously for an application, returning every
 * blocking reason instead of throwing for it. Activates the rules engine for
 * codes it knows (CL/EL/HPL/ML/PL/CCL/...); codes outside the engine (e.g.
 * EOL/MED) are checked for balance directly (the same check the consumer
 * would otherwise make asynchronously, after the 202, where a failure was
 * invisible to the applicant -- GAP-HR-LEAVE-APPLY-04).
 *
 * Authorisation / lookup failures (403 IDOR guard, 404 unknown
 * allocation/type/employee) are NOT rule outcomes and still throw.
 */
async function evaluateLeaveRules(ctx: RequestContext, body: ReturnType<typeof applyLeaveBody.parse>, req: FastifyRequest): Promise<LeaveEvaluation> {
  const tenantId = ctx.tenantId;
  const alloc = await repo.findAllocById(body.allocId);
  if (!alloc) throw new HttpError(404, "ALLOC_NOT_FOUND", "leave allocation not found");
  // The allocation is the balance both this check and the later debit read, so
  // it must be THIS employee's pool for THIS leave type -- otherwise a request
  // could be validated against (and, on approval, debited from) another
  // employee's or another leave type's balance just by passing its id.
  if (alloc.employeeId !== body.employeeId || alloc.leaveTypeId !== body.leaveTypeId) {
    throw new HttpError(404, "ALLOC_NOT_FOUND", "leave allocation not found for this employee and leave type");
  }
  const balance = effectiveBalanceDays(alloc);
  const violation = (code: string, message: string): LeaveEvaluation =>
    ({ computedDays: null, warnings: [], violations: [{ code, message }], holidaysInRange: [], balance });
  const types = await repo.listLeaveTypesByTenant(tenantId);
  const lt = types.find((t) => t.id === body.leaveTypeId);
  if (!lt) throw new HttpError(404, "LEAVE_TYPE_NOT_FOUND", "leave type not found");
  const code = (lt.code ?? "").toUpperCase();
  const [emp] = await scopedRead((tx) => tx.select().from(hrmsEmployees).where(eq(hrmsEmployees.id, body.employeeId)));
  if (!emp) throw new HttpError(404, "EMP_NOT_FOUND", "employee not found");
  // IDOR guard + reporting-line-scoped manager exemption:
  //  - HR roles: full exemption (existing "HR enters leave on behalf of an
  //    employee who can't self-service" workflow).
  //  - "manager" role: exempt ONLY for their own direct reports, checked via
  //    hrmsEmployees.managerId — the real reporting-line field (already used
  //    by orgchart/deputation for exactly this relationship), not just role
  //    membership. A manager with no organizational relationship to the
  //    target employee is not exempt merely for holding the role.
  //  - everyone else (bare "employee"): only their own linked record.
  // The actor's own employee record is resolved via resolveEmployeeForActor —
  // userRef primary, email fallback + auto-link — the same single source of
  // truth self-service/routes.ts's "my profile" family uses, so an employee
  // whose userRef isn't linked yet doesn't get a spurious 403 applying for
  // themselves just because /me/profile was never called first.
  const isHrActor = HR_ROLES.some((r) => ctx.roles.includes(r));
  if (!isHrActor) {
    const actorEmp = await resolveEmployeeForActor(tenantId, ctx.actorId);
    const isSelf = actorEmp?.id === body.employeeId;
    const isManagerOfTarget = ctx.roles.includes("manager") && actorEmp != null && emp.managerId === actorEmp.id;
    if (!isSelf && !isManagerOfTarget) {
      throw new HttpError(403, "FORBIDDEN", "employees may only apply for leave on their own employee record (or, for managers, a direct report's)");
    }
  }
  // DIC engagement gate — an engagement type not entitled to the salaried leave
  // scheme (consultant invoice-billed, third_party agency-deployed) cannot draw
  // on the DIC leave ledger. Runs for EVERY leave code, before the CCS-engine
  // early-return below. Fail-open on resolver error so a transient failure never
  // blocks a legitimate application.
  const resolver = await loadTypeResolver(tenantId).catch((err: unknown) => {
    // Fail open, but make the control's failure observable — if the resolver
    // starts failing consistently the eligibility gate silently stops enforcing.
    req.log.error({ err, event: "leave.eligibility.resolver_failed", tenantId }, "leave eligibility resolver failed — failing open");
    return null;
  });
  if (resolver && !leaveEligible(resolver(emp.employeeType ?? ""))) {
    return violation(
      "LEAVE_NOT_ELIGIBLE",
      `engagement type '${emp.employeeType ?? "unknown"}' is not eligible for the leave scheme — this workforce category does not accrue leave`,
    );
  }
  // DEF-LM-002 (T&A-LM-0283): reject a new application whose dates overlap an
  // existing pending/approved leave for the same employee. Prevents double-booking
  // the same calendar days across leave types. Runs for EVERY leave code (not just
  // CCS-engine codes) so it must precede the early-return below.
  // GAP-HR-LEAVE-APPLY-05: half-day / short leave is gated by the tenant switch
  // (default OFF) and by the leave type (CL only); anything else is whole-day.
  if (body.dayPart !== "full") {
    try {
      assertDayPartAllowed(body.dayPart, code, await repo.getLeaveTenantConfig(tenantId));
    } catch (err) {
      if (err instanceof DomainError) return violation(err.code, err.message);
      throw err;
    }
  }
  const overlaps = blockingOverlaps(
    await repo.findOverlappingLeaveApps(tenantId, body.employeeId, body.fromDate, body.toDate),
    { fromDate: body.fromDate, toDate: body.toDate, dayPart: body.dayPart },
  );
  if (overlaps.length > 0) {
    const clash = overlaps[0]!;
    return violation(
      "LEAVE_OVERLAP",
      `leave dates ${body.fromDate}..${body.toDate} overlap an existing ${clash.status} application (${clash.fromDate}..${clash.toDate}, id ${clash.id})`,
    );
  }
  if (!LEAVE_POLICIES.some((pol) => pol.code === code)) {
    // Outside the CCS engine: the client-submitted day count stands, but the
    // balance is still enforced HERE -- the consumer's identical check runs
    // after the 202 has already been returned, so a shortfall used to vanish
    // silently (GAP-HR-LEAVE-APPLY-04).
    try {
      assertSufficientLeaveBalance({ totalDays: alloc.totalDays, balanceDays: balance }, body.daysApplied);
    } catch (err) {
      if (err instanceof DomainError) return violation(err.code, err.message);
      throw err;
    }
    return { computedDays: null, warnings: [], violations: [], holidaysInRange: [], balance };
  }
  const allowed: EmployeeType[] = ["permanent", "temporary", "contract", "deputation"];
  const empType = (allowed as string[]).includes(emp.employeeType ?? "")
    ? (emp.employeeType as EmployeeType) : "permanent";
  const result = await validateLeaveRequest({
    employeeType: empType,
    leaveCode: code as LeaveCategory,
    fromDate: body.fromDate,
    toDate: body.toDate,
    daysApplied: body.daysApplied,
    currentBalance: balance,
    dayPart: body.dayPart,
    totalAccumulated: alloc.totalDays,
    serviceStartDate: (emp.dateOfJoining as unknown as string) ?? body.fromDate,
    tenantId,
    isOnProbation: (emp.status ?? "") === "probation",
    // DOM-009: leaveTypeId + the employee's raw (unnarrowed) employeeType let
    // validateLeaveRequest look up this tenant's admin-configured policy row
    // instead of only ever using the hardcoded default catalog.
    leaveTypeId: body.leaveTypeId,
    rawEmployeeType: emp.employeeType ?? undefined,
  });
  return {
    // BUG-1 fix: hand back the rules-engine's validated day count so the caller
    // persists/debits *this*, not the raw client-submitted daysApplied.
    computedDays: result.computedDays,
    warnings: result.warnings,
    violations: result.valid ? [] : result.errors.map((message) => ({ code: "LEAVE_RULE_VIOLATION", message })),
    holidaysInRange: result.holidaysInRange,
    balance,
  };
}

/**
 * Enforce CCS(Leave) Rules synchronously before accepting a leave application.
 * Throws 422 on a rule violation (the first violation's code; every message
 * joined, exactly as before this was split out of evaluateLeaveRules).
 *
 * Returns the rules-engine's computed day count (holiday/sandwich/prefix-suffix
 * aware) when the CCS engine ran, or null when the leave code is outside the
 * engine — callers should fall back to the client-submitted daysApplied in
 * that case, matching the pre-existing "nothing breaks" behavior for EOL/MED.
 */
async function enforceCcsLeaveRules(ctx: RequestContext, body: ReturnType<typeof applyLeaveBody.parse>, req: FastifyRequest): Promise<number | null> {
  const evaluation = await evaluateLeaveRules(ctx, body, req);
  if (evaluation.violations.length > 0) {
    throw new HttpError(422, evaluation.violations[0]!.code, evaluation.violations.map((v) => v.message).join("; "));
  }
  return evaluation.computedDays;
}

export async function leaveRoutes(app: FastifyInstance): Promise<void> {
  // AUTH-ORDERING FIX: Fastify's default JSON body parser throws
  // FST_ERR_CTP_EMPTY_JSON_BODY (400) for an empty body sent with
  // Content-Type: application/json -- and that happens during Fastify's
  // parsing lifecycle stage, which runs BEFORE preValidation/preHandler/the
  // route handler. Every handler in this module already does
  // resolveContext()+requireRole() as its first statements (auth before any
  // body/param validation) -- but that ordering was moot for callers who
  // send no body (e.g. PATCH .../approve with an empty payload): the 400
  // fired before the handler, and thus before requireRole, ever ran, so an
  // unauthorized caller learned "your body is empty" instead of "you are
  // not allowed to do this." Same fix as gateway-service's app.ts: treat an
  // empty JSON body as {} so parsing succeeds and control reaches the
  // handler's auth check first; a genuinely malformed (non-empty, invalid)
  // JSON body still surfaces as 400 via the caught SyntaxError below.
  app.addContentTypeParser(
    "application/json",
    { parseAs: "string" },
    (_req, body, done) => {
      try {
        done(null, body ? JSON.parse(body as string) : {});
      } catch (err) {
        const syntaxErr = err as Error & { statusCode?: number };
        syntaxErr.statusCode = 400;
        done(syntaxErr, undefined);
      }
    },
  );

  app.post("/v1/hrms/leave-types", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, HR_ROLES);
    const body = createLeaveTypeBody.parse(req.body);
    return sendAccepted(reply, acceptedResponseSchema, await commands.createLeaveType(ctx, body));
  });

  // GAP-HR-LEAVE-APPLY-05: per-tenant half-day / short-leave switch. Anyone who
  // can apply needs to READ it (to show the control); only HR admins change it.
  app.get("/v1/hrms/leave-config", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, ALL_ROLES);
    return reply.send(await repo.getLeaveTenantConfig(ctx.tenantId));
  });

  app.put("/v1/hrms/leave-config", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, LEAVE_CONFIG_ADMIN_ROLES);
    const body = leaveTenantConfigBody.parse(req.body);
    return sendAccepted(reply, acceptedResponseSchema, await commands.setLeaveTenantConfig(ctx, body));
  });

  app.get("/v1/hrms/leave-allocations", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, ALL_ROLES);
    // IDOR guard: this route had zero employee scoping — self-service employees
    // see only their own allocations, managers see their direct reports', HR
    // keeps full tenant access (unchanged).
    const employeeIds = await resolveLeaveReadScope(ctx, req, undefined);
    const allocs = await queries.listLeaveAllocations(ctx.tenantId, 50, employeeIds);
    return reply.send({ data: allocs });
  });

  app.post("/v1/hrms/leave-allocations", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, HR_ROLES);
    const body = allocateLeaveBody.parse(req.body);
    return sendAccepted(reply, acceptedResponseSchema, await commands.allocateLeave(ctx, body));
  });

  app.post("/v1/hrms/leave-applications", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, ALL_ROLES);
    const body = applyLeaveBody.parse(req.body);
    const computedDays = await enforceCcsLeaveRules(ctx, body, req);
    // BUG-1 fix: persist/debit the validated computed day count, not the raw
    // client-submitted one, when the CCS rules engine actually ran for this code.
    const applyBody = computedDays != null ? { ...body, daysApplied: computedDays } : body;
    return sendAccepted(reply, acceptedResponseSchema, await commands.applyLeave(ctx, applyBody));
  });

  app.post("/v1/hrms/leave-requests", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, ALL_ROLES);
    const body = applyLeaveBody.parse(req.body);
    const computedDays = await enforceCcsLeaveRules(ctx, body, req);
    const applyBody = computedDays != null ? { ...body, daysApplied: computedDays } : body;
    return sendAccepted(reply, acceptedResponseSchema, await commands.applyLeave(ctx, applyBody));
  });

  // GAP-HR-LEAVE-APPLY-01: read-only preview of what a submit would actually
  // debit. ApplyLeaveForm.tsx's calcDays() is a naive inclusive calendar-day
  // count; the real debit (BUG-1 fix, above) comes from the CCS rules engine
  // (holidays/sandwich/prefix-suffix aware) -- the applicant previously never
  // saw that number until after submitting.
  // Runs evaluateLeaveRules -- the exact function POST /leave-requests runs
  // (same IDOR guard, engagement-eligibility gate, overlap check, rules
  // engine and balance check) -- minus the trailing commands.applyLeave
  // publish, so preview and submit can never diverge. Authorisation/lookup
  // failures (403/404) throw exactly as submit would. A RULE outcome
  // (insufficient balance, rule violation, overlap ...) is returned as data
  // (`valid: false` + `violations`) rather than a bare 422, so the form can
  // say WHY inline and keep Submit disabled -- the same violations submit
  // would answer with a 422 (never a window.confirm the user could click
  // through).
  app.post("/v1/hrms/leave-requests/preview", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, ALL_ROLES);
    const body = applyLeaveBody.parse(req.body);
    const evaluation = await evaluateLeaveRules(ctx, body, req);
    const computedDays = evaluation.computedDays ?? body.daysApplied;
    return reply.send({
      valid: evaluation.violations.length === 0,
      computedDays,
      // false for a leave code outside the CCS engine (e.g. EOL/MED) -- the
      // day count is then the client-submitted one, shown as approximate.
      engineApplied: evaluation.computedDays != null,
      warnings: evaluation.warnings,
      violations: evaluation.violations,
      holidaysInRange: evaluation.holidaysInRange,
      balance: evaluation.balance,
      balanceAfter: evaluation.balance - computedDays,
    });
  });

  app.patch("/v1/hrms/leave-applications/:id/approve", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, [...HR_ROLES, "manager"]);
    // Managers without HR/super_admin roles must go through the workflow queue
    if (!ctx.roles.some((r: string) => HR_ROLES.includes(r))) {
      throw new HttpError(403, "WORKFLOW_REQUIRED", "Direct approval requires HR admin privileges. Use the workflow queue.");
    }
    await requirePermissionKey(ctx, "hrms.leave.approve");
    const { id } = idParam.parse(req.params);
    const leaveApp = await repo.findLeaveAppById(id, ctx.tenantId);
    if (!leaveApp) throw new HttpError(404, "NOT_FOUND", "leave application not found");
    if (leaveApp.createdBy === ctx.actorId) {
      throw new HttpError(403, "SELF_APPROVAL_FORBIDDEN", "Maker-checker: you cannot approve your own leave application.");
    }
    return sendAccepted(reply, acceptedResponseSchema, await commands.approveLeave(ctx, id));
  });

  app.patch("/v1/hrms/leave-applications/:id/reject", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, [...HR_ROLES, "manager"]);
    // Managers without HR/super_admin roles must go through the workflow queue
    // — same gate approve enforces; reject had no equivalent gate before this fix.
    if (!ctx.roles.some((r: string) => HR_ROLES.includes(r))) {
      throw new HttpError(403, "WORKFLOW_REQUIRED", "Direct rejection requires HR admin privileges. Use the workflow queue.");
    }
    await requirePermissionKey(ctx, "hrms.leave.approve");
    const { id } = idParam.parse(req.params);
    const body = rejectLeaveBody.parse(req.body);
    return sendAccepted(reply, acceptedResponseSchema, await commands.rejectLeave(ctx, id, body.reason));
  });

  // ── Aliases: some clients use leave-requests, others leave-applications ──
  app.patch("/v1/hrms/leave-requests/:id/approve", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, [...HR_ROLES, "manager"]);
    await requirePermissionKey(ctx, "hrms.leave.approve");
    if (!ctx.roles.some((r: string) => HR_ROLES.includes(r))) {
      throw new HttpError(403, "WORKFLOW_REQUIRED", "Direct approval requires HR admin privileges. Use the workflow queue.");
    }
    const { id } = idParam.parse(req.params);
    const leaveApp = await repo.findLeaveAppById(id, ctx.tenantId);
    if (!leaveApp) throw new HttpError(404, "NOT_FOUND", "leave application not found");
    if (leaveApp.createdBy === ctx.actorId) {
      throw new HttpError(403, "SELF_APPROVAL_FORBIDDEN", "Maker-checker: you cannot approve your own leave application.");
    }
    return sendAccepted(reply, acceptedResponseSchema, await commands.approveLeave(ctx, id));
  });

  app.patch("/v1/hrms/leave-requests/:id/reject", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, [...HR_ROLES, "manager"]);
    // Managers without HR/super_admin roles must go through the workflow queue
    // — same gate approve's alias enforces; reject's alias had no equivalent gate.
    if (!ctx.roles.some((r: string) => HR_ROLES.includes(r))) {
      throw new HttpError(403, "WORKFLOW_REQUIRED", "Direct rejection requires HR admin privileges. Use the workflow queue.");
    }
    await requirePermissionKey(ctx, "hrms.leave.approve");
    const { id } = idParam.parse(req.params);
    const body = rejectLeaveBody.parse(req.body);
    return sendAccepted(reply, acceptedResponseSchema, await commands.rejectLeave(ctx, id, body.reason));
  });

  app.get("/v1/hrms/leave/applications", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, ALL_ROLES);
    const q = listQuerySchema.extend({ empId: z.string().uuid().optional() }).parse(req.query);
    // IDOR guard: empId used to be taken raw with no ownership check.
    const employeeIds = await resolveLeaveReadScope(ctx, req, q.empId);
    if (employeeIds !== undefined) {
      if (employeeIds.length === 0) {
        return reply.send({ data: [], meta: { page: 1, pageSize: q.limit, offset: q.offset, total: 0, hasMore: false, statusCounts: {} } });
      }
      // GAP-HR-LEAVE-HISTORY-01: real limit/offset + a real total, replacing
      // the previous `meta.total = data.length` (silently under-reported
      // beyond the first ~100 rows regardless of what the caller asked
      // for). The web caller of this route (LeaveHistoryClient.tsx) always
      // resolves and sends a single `empId` once known, so `employeeIds`
      // here is a multi-element array only when a manager's request omits
      // `empId` entirely — a shape this page's own UI never produces.
      // Page/total math is exact for the single-id case that matters; a
      // multi-id caller gets each employee's own page concatenated (still
      // correctly ordered/limited per employee, just not one globally
      // merged page across employees — true cross-employee merge
      // pagination is out of scope here).
      const results = await Promise.all(
        employeeIds.map((id) => queries.getLeaveApplicationsByEmp(ctx.tenantId, id, q.limit, q.offset)),
      );
      const data = results.flatMap((r) => r.data);
      const total = results.reduce((sum, r) => sum + r.total, 0);
      const statusCounts = results.reduce<Record<string, number>>((acc, r) => {
        for (const [status, count] of Object.entries(r.statusCounts)) acc[status] = (acc[status] ?? 0) + count;
        return acc;
      }, {});
      return reply.send({
        data,
        meta: { page: Math.floor(q.offset / q.limit) + 1, pageSize: q.limit, offset: q.offset, total, hasMore: data.length === q.limit, statusCounts },
      });
    }
    const result = await queries.listLeaveApplications(ctx.tenantId, q.limit, q.offset);
    return reply.send({ data: result.data, meta: { page: Math.floor(q.offset / q.limit) + 1, pageSize: q.limit, offset: q.offset, hasMore: result.data.length === q.limit } });
  });

  app.get("/v1/hrms/leave-applications", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, ALL_ROLES);
    const q = listQuerySchema.extend({ empId: z.string().uuid().optional() }).parse(req.query);
    // IDOR guard: empId used to be taken raw with no ownership check.
    const employeeIds = await resolveLeaveReadScope(ctx, req, q.empId);
    if (employeeIds !== undefined) {
      if (employeeIds.length === 0) {
        sendValidated(reply, leaveListResponseSchema, { data: [] });
        return;
      }
      const parts = await Promise.all(employeeIds.map((id) => queries.listLeaveApplicationsByEmp(ctx.tenantId, id)));
      sendValidated(reply, leaveListResponseSchema, { data: parts.flatMap((p) => p.data) });
      return;
    }
    sendValidated(reply, leaveListResponseSchema, await queries.listLeaveApplications(ctx.tenantId, q.limit, q.offset));
  });

  app.get("/v1/hrms/leave-requests", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, ALL_ROLES);
    const q = listQuerySchema.extend({
      empId: z.string().uuid().optional(),
      // GAP-HR-LEAVE-APPROVALS-04: lets a caller (the approvals panel) ask
      // for exactly the applications it already knows it needs (the refIds
      // of its own visible pending tasks) instead of loading its entire
      // tenant/manager-scoped page just to label a handful of rows. This is
      // a NARROWING on top of the existing role-based scope below, never a
      // widening one -- an id outside that scope is silently dropped, same
      // as any other row that scope excludes today.
      ids: z.string().optional().transform((v) => (v ? v.split(",").filter(Boolean) : undefined))
        .pipe(z.array(z.string().uuid()).max(50).optional()),
      // GAP-HR-LEAVE-03: opt in to `{ data, meta }` (real total + per-status
      // counts over the caller's whole visible set). Absent = the bare array
      // every existing caller already parses.
      withMeta: z.enum(["1", "true"]).optional(),
    }).parse(req.query);
    // IDOR fix (GAP-HR-SF-16): this route returned every employee's leave
    // request detail tenant-wide to ANY ALL_ROLES-holding caller (including
    // a bare "employee"), with zero scoping -- unlike its siblings
    // /leave-applications and /leave-allocations, which already call
    // resolveLeaveReadScope. Reuses that exact helper/pattern: HR keeps the
    // full tenant view (unchanged); a manager is scoped to their direct
    // reports (never themselves -- "my team" = direct reports, not self,
    // same convention as the sibling routes' own regression tests); a bare
    // employee is scoped to just their own linked record.
    //
    // GAP-HR-LEAVE-03/04 follow-up: scoping used to be a post-fetch filter
    // applied on top of an already limit/offset-truncated tenant-wide query
    // (with no ORDER BY) — a manager/employee's own rows could fall outside
    // that page and be silently dropped even though they existed. Scoping
    // now happens in the WHERE clause itself (repo.findLeaveAppsByTenant's
    // employeeIds param) with a deterministic ORDER BY, so limit/offset
    // paginate the caller's own visible set, not the tenant's.
    const employeeIds = await resolveLeaveReadScope(ctx, req, q.empId);
    if (q.ids) {
      // GAP-HR-LEAVE-APPROVALS-04: id-based read for the approvals panel. The
      // ids are fetched directly (not filtered out of a limit/offset page, which
      // dropped any id beyond the first page) and authorised PER RECORD: HR
      // sees any; otherwise the caller's own/direct-report scope applies, and
      // a record outside it is released only if the caller holds an OPEN
      // workflow approval task on it (workflow-service, fail-closed) -- the
      // "approver who is not the line manager" case. Anything else is silently
      // dropped, same as the role scope has always done.
      const found = await queries.listLeaveRequestDetailsByIds(ctx.tenantId, q.ids);
      const inScope = (r: { employeeId: string }) => employeeIds === undefined || employeeIds.includes(r.employeeId);
      const outside = found.filter((r) => !inScope(r));
      let viaTask = new Set<string>();
      if (outside.length > 0) {
        viaTask = await fetchOpenTaskRefIds({
          tenantId: ctx.tenantId, actorId: ctx.actorId, roles: ctx.roles,
          refType: "leave_app", refIds: outside.map((r) => r.id),
        });
      }
      const allowed = found.filter((r) => inScope(r) || viaTask.has(r.id));
      sendValidated(reply, LeaveRequestDetailListSchema, allowed);
      return;
    }
    if (q.withMeta) {
      const result = await queries.getLeaveRequestPage(ctx.tenantId, q.limit, q.offset, employeeIds);
      sendValidated(reply, LeaveRequestPageSchema, {
        data: result.data,
        meta: {
          page: Math.floor(q.offset / q.limit) + 1,
          pageSize: q.limit,
          offset: q.offset,
          total: result.total,
          hasMore: q.offset + result.data.length < result.total,
          statusCounts: result.statusCounts,
        },
      });
      return;
    }
    const rows = await queries.listLeaveRequestDetails(ctx.tenantId, q.limit, q.offset, employeeIds);
    sendValidated(reply, LeaveRequestDetailListSchema, rows);
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
  // Fastify client errors (e.g. malformed/empty JSON body) carry a 4xx
  // statusCode — surface them as client errors, not masked 500s.
  const sc = (err as { statusCode?: number })?.statusCode;
  if (typeof sc === "number" && sc >= 400 && sc < 500) {
    const code = (err as { code?: string })?.code ?? "BAD_REQUEST";
    void reply.code(sc).send({ code, message: (err as Error)?.message ?? "bad request", correlationId, retryable: false });
    return;
  }
  req.log.error({ err }, "unhandled error");
  void reply.code(500).send({ code: "INTERNAL", message: "internal error", correlationId, retryable: true });
}
