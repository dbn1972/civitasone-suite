import type { FastifyInstance } from "fastify";
import { z, ZodError } from "zod";
import { resolveContext, requireRole, HttpError } from "../../shared/context.js";
import * as employeeRepo from "../employee/repo.js";
import * as leaveRepo from "../leave/repo.js";
import * as attendanceRepo from "../attendance/repo.js";
import { getHolidaysInRange, countWorkingDaysExcludingHolidays } from "../leave/rules-engine.js";
import { activePaySuspendedEmployeeIds } from "../disciplinary/repo.js";
import { loadTypeResolver, attendanceLopApplies } from "../employee/engagement-policy.js";
import { resolveEmployeeForActor } from "../employee/actor-link.js";

const INTERNAL_ROLES = ["super_admin", "payroll_admin", "hr_admin"];

export async function internalRoutes(app: FastifyInstance): Promise<void> {
  app.get("/v1/hrms/internal/payroll-input", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, INTERNAL_ROLES);
    const q = z.object({ month: z.string().regex(/^\d{4}-\d{2}$/) }).parse(req.query);

    // BUG-1 fix: this feed IS the complete payroll-input set for the run --
    // payroll-service's fetchPayrollInput() (hrms-client.ts) does no pagination
    // of its own and treats `employees` as the whole tenant. A hardcoded
    // listByTenant(tenantId, 500, 0) silently dropped every employee past the
    // 500th (no error, no truncation flag -- they just never got paid). Page
    // through listByTenant until a short page proves there are no more, the
    // same pattern already used for `active` bounds elsewhere in this file's
    // batched pre-fetches. No known tenant is anywhere near a scale where
    // returning everyone is itself a problem (contrast employee-summaries'
    // .limit(2000) below and its own "round2 review fix" comment about an
    // arbitrary cap silently producing an incomplete result) -- this is a
    // correctness fix, not a premature optimization.
    const PAGE_SIZE = 500;
    const employees: Awaited<ReturnType<typeof employeeRepo.listByTenant>> = [];
    for (let offset = 0; ; offset += PAGE_SIZE) {
      const page = await employeeRepo.listByTenant(ctx.tenantId, PAGE_SIZE, offset);
      employees.push(...page);
      if (page.length < PAGE_SIZE) break;
    }
    const active = employees.filter((e) => e.status !== "separated");
    // DIC engagement policy per employee (payroll excludes non-salary types +
    // gates statutory). Resolver = tenant type master over canonical catalogue.
    const resolveType = await loadTypeResolver(ctx.tenantId);
    const approvedLeaves = await leaveRepo.findApprovedLeaveInMonth(ctx.tenantId, q.month);
    // MEDIUM fix: approved overtime hours by employee, so payroll-service can
    // see them at all -- see attendanceRepo.findApprovedOvertimeInMonth's
    // doc comment. NOTE: surfacing only. payroll-service's shared/hrms-client.ts
    // types this field on HrmsPayrollInput but nothing in payroll's own
    // slip/run computation consumes it yet to actually pay for it -- that
    // (rate lookup, which pay component it lands in, statutory treatment of
    // OT pay) is a larger, separate change, deliberately deferred rather
    // than done partially here.
    const overtimeHoursByEmployee = await attendanceRepo.findApprovedOvertimeInMonth(ctx.tenantId, q.month);
    // Pay-suspension flag from the Disciplinary module: active suspensions with
    // pay_suspended=true. Payroll applies subsistence allowance / withholds pay.
    const paySuspended = await activePaySuspendedEmployeeIds(ctx.tenantId);

    // DIC engagement applicability: employees whose type's muster absence must NOT
    // drive salary Loss-of-Pay (consultants invoice-billed, third-party agency-paid,
    // apprentices on a NAPS stipend). Their attendance is informational only, so we
    // exclude them from both the leave-LOP and attendance-LOP accrual below.
    const noSalaryLop = new Set<string>();
    for (const emp of active) {
      if (!attendanceLopApplies(resolveType(emp.employeeType))) noSalaryLop.add(emp.id);
    }

    // Bug fix: this used to call leave/holidays.ts's countWorkingDays(),
    // sourced from a hardcoded RESTRICTED_HOLIDAYS calendar covering only
    // 2024-2026, whose own `Math.max(count, 1)` floor meant a single-day
    // leave landing on a weekend/holiday was still counted as 1 LOP day
    // (weekends/holidays were never actually excluded). Now uses the real,
    // tenant-configurable hrms_holidays calendar — the same source
    // leave-application validation already uses (leave/rules-engine.ts) —
    // fetched once for the whole date range covered by this month's
    // LOP-eligible approved leaves rather than once per leave record.
    const lopByEmployee = new Map<string, number>();
    const lopEligibleLeaves = approvedLeaves.filter((leave) => !noSalaryLop.has(leave.employeeId));
    let holidaySet = new Set<string>();
    if (lopEligibleLeaves.length > 0) {
      const rangeFrom = lopEligibleLeaves.map((l) => l.fromDate).reduce((a, b) => (a < b ? a : b));
      const rangeTo = lopEligibleLeaves.map((l) => l.toDate).reduce((a, b) => (a > b ? a : b));
      holidaySet = new Set(await getHolidaysInRange(ctx.tenantId, rangeFrom, rangeTo));
    }
    // HIGH fix (LOP-ignores-leave-type bug): this used to count every
    // approved leave day toward LOP regardless of leave type. Fetched once
    // for the whole tenant (typically a handful of types) rather than once
    // per leave record, same batching posture as the PERF-005 fix just
    // below. Same lopFractionBps this route's sibling
    // (.../leave-types/:id/lop-fraction-bps, which payroll-service calls for
    // its own event-driven ledger) reads from -- both paths share the exact
    // same source column, so they can never disagree.
    const lopFractionByTypeId = new Map(
      (await leaveRepo.listLeaveTypesByTenant(ctx.tenantId)).map((lt) => [lt.id, lt.lopFractionBps]),
    );
    for (const leave of lopEligibleLeaves) {
      const days = countWorkingDaysExcludingHolidays(leave.fromDate, leave.toDate, holidaySet);
      // Unknown leave type (shouldn't happen -- every leave app's
      // leaveTypeId is a real FK -- but fails toward "fully counts as LOP"
      // rather than silently exempting it, same posture as this column's
      // own DEFAULT 10000) mirrors attendanceLopApplies's own default-to-true
      // convention just above.
      const lopFractionBps = lopFractionByTypeId.get(leave.leaveTypeId) ?? 10000;
      if (lopFractionBps === 0) continue; // fully-paid leave type: no LOP.
      const lopDays = Math.round((days * lopFractionBps) / 10000);
      if (lopDays <= 0) continue;
      lopByEmployee.set(leave.employeeId, (lopByEmployee.get(leave.employeeId) ?? 0) + lopDays);
    }

    // PERF-005: was one findByEmpAndMonth query per active, LOP-eligible
    // employee; now a single batch query across all of them.
    const lopEligibleIds = active.filter((emp) => !noSalaryLop.has(emp.id)).map((emp) => emp.id);
    const attendanceByEmployee = await attendanceRepo.findByEmpsAndMonth(ctx.tenantId, lopEligibleIds, q.month);

    for (const emp of active) {
      if (noSalaryLop.has(emp.id)) continue;
      const attRows = attendanceByEmployee.get(emp.id) ?? [];
      const absentDays = attRows.filter((a) => a.status === "absent" || a.status === "half_day").length;
      if (absentDays > 0) {
        lopByEmployee.set(emp.id, (lopByEmployee.get(emp.id) ?? 0) + absentDays);
      }
    }

    // P0-1: field-level access log for the sensitive-PII payroll projection
    // (pan / bankAccountNo / bankIfsc decrypted at rest and returned to payroll).
    req.log.info({ event: "pii.access", projection: "payroll-input", fields: ["pan","bankAccountNo","bankIfsc"], count: active.length, actorId: ctx.actorId, tenantId: ctx.tenantId, month: q.month }, "payroll-input PII projection");

    return reply.send({
      month: q.month,
      employees: active.map((e) => {
        const pol = resolveType(e.employeeType);
        return {
          id: e.id,
          employeeNo: e.employeeNo,
          fullName: e.fullName,
          basicMinor: e.basicMinor.toString(),
          // BUG-1 fix: payroll-service needs this to pro-rate a mid-month joiner's
          // first slip (days before joining, within the run month, are unpaid).
          // There is no symmetric "date of leaving" column on hrms_employees — a
          // separated employee's status flips to "separated" as part of the same
          // lifecycle transaction that records the separation (see
          // lifecycle/consumer.ts COMMANDS.lifecycleSeparate), so they are already
          // excluded above (`status !== "separated"`) before this projection ever
          // runs; their partial final month + terminal dues are priced by the
          // Full & Final Settlement flow off its own separationDate, not by this
          // endpoint or the regular payroll run.
          dateOfJoining: e.dateOfJoining,
          payStructureId: e.payStructureId,
          bankAccountNo: e.bankAccountNo,
          bankIfsc: e.bankIfsc,
          pan: e.pan,
          uan: e.uanNumber,
          esicIp: e.esicIpNumber,
          pran: e.pran,
          cityClass: (e.hraCityClass ?? "X") as "X" | "Y" | "Z",
          taxRegime: (e.taxRegime ?? "new") as "old" | "new",
          departmentId: e.departmentId,
          pensionScheme: (e.pensionScheme ?? "NPS") as "GPF" | "NPS" | "EPF",
          paySuspended: paySuspended.has(e.id),
          ...(paySuspended.has(e.id) ? { subsistencePct: Number(paySuspended.get(e.id)!.subsistencePct) } : {}),
          // DIC engagement policy — payroll consumes these to exclude non-salary
          // types (consultant/third-party/apprentice) and gate PF/ESI/NPS.
          engagementType: e.employeeType,
          paymentRoute: pol.paymentRoute,
          eligibleForPayroll: pol.eligibleForPayroll,
          attendanceMode: pol.attendanceMode,
          statutoryPf: pol.statutoryPf,
          statutoryEsi: pol.statutoryEsi,
          statutoryNps: pol.statutoryNps,
        };
      }),
      lopDays: Object.fromEntries(lopByEmployee.entries()),
      overtimeHours: Object.fromEntries(overtimeHoursByEmployee.entries()),
    });
  });

  /**
   * payroll-critical fix (payslip self-service): payroll-service's own
   * database has no employee-identity table (separate DB, see this module's
   * other routes' comments), so it cannot run resolveEmployeeForActor
   * (employee/actor-link.ts) itself the way this service's own self-service
   * routes do (medical/routes.ts's resolveSelfScopedEmployeeId and friends).
   * This is the cross-service equivalent: same resolver, reached over the
   * internal boundary like payroll-input/employee-summaries above.
   *
   * :actorId and ?email are EXPLICIT parameters, not read from this
   * request's own ctx.actorId -- an x-internal call authenticates as the
   * fixed internal service account (resolveServiceContextInner in
   * packages/auth/src/context.ts), not as the original end user, so the
   * caller (payroll-service) must forward the real actor's id/email itself.
   * Returns `employeeId: null` (200), not 404, when the actor has no linked
   * employee record -- a real "you have no self-service identity" outcome
   * the caller must treat as "cannot own anything" (fails closed), mirroring
   * resolveEmployeeForActor's own `undefined` contract.
   */
  app.get("/v1/hrms/internal/employees/actor/:actorId/resolve", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, INTERNAL_ROLES);
    const { actorId } = z.object({ actorId: z.string().uuid() }).parse(req.params);
    const q = z.object({ email: z.string().email().optional() }).parse(req.query);
    const emp = await resolveEmployeeForActor(ctx.tenantId, actorId, q.email);
    return reply.send({ employeeId: emp ? emp.id : null });
  });

  app.setErrorHandler((err, req, reply) => {
    const correlationId = (req.headers["x-correlation-id"] as string) ?? req.id;
    if (err instanceof ZodError) {
      return reply.code(400).send({ code: "VALIDATION_FAILED", message: "invalid request", correlationId, fieldErrors: err.issues.map((i) => ({ field: i.path.join("."), message: i.message })) });
    }
    if (err instanceof HttpError) return reply.code(err.status).send({ code: err.code, message: err.message, correlationId });
    req.log.error({ err }, "unhandled error");
    return reply.code(500).send({ code: "INTERNAL", message: "internal error", correlationId });
  });
  // Employee summaries for payroll service (id → fullName + departmentName)
  //
  // HIGH security fix: this route used to read req.headers["x-tenant-id"]
  // directly with NO resolveContext/requireRole call at all -- unlike every
  // other route in this file (payroll-input above; employees/:id/exists and
  // attendance-lop-applies below), which correctly gate on
  // resolveContext(req) + requireRole(ctx, INTERNAL_ROLES) and use
  // ctx.tenantId. That meant ANY caller (no bearer token, no x-internal
  // service secret, nothing) could pass an arbitrary x-tenant-id and read
  // back that tenant's employee id/fullName/departmentId — a real
  // authentication bypass, not merely a "trusts a header" gap: unlike the
  // legacy assumption that RLS alone protected this (a spoofed tenant header
  // only produces an empty-intersection query, not a breach, because
  // scopedRead's GUC was never set from THIS header to begin with), there was
  // no auth check here whatsoever.
  //
  // resolveServiceContext (packages/auth/src/context.ts) is the correct,
  // already-proven-safe gate for this endpoint's real callers
  // (payroll-service's and estab-service's hrms-client.ts, confirmed by
  // reading both): they send x-internal:"1" + x-service-secret +
  // x-tenant-id, exactly the header set resolveServiceContext's own
  // service-account branch validates (constant-time compare against
  // INTERNAL_SERVICE_SECRET) before trusting x-tenant-id as ctx.tenantId and
  // granting the fixed internal-service role set. So switching to
  // resolveContext+requireRole here closes the hole without breaking either
  // real caller — it is the exact same mechanism their sibling routes
  // (payroll-input, employees/:id/exists, attendance-lop-applies,
  // slip-templates/default) already rely on.
  app.get("/v1/hrms/internal/employee-summaries", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, INTERNAL_ROLES);
    const { scopedRead } = await import("../../shared/db.js");
    const { hrmsEmployees, hrmsDepartments } = await import("../employee/schema.js");
    const { eq, and } = await import("drizzle-orm");
    const employees = await scopedRead((tx) =>
      tx.select({ id: hrmsEmployees.id, fullName: hrmsEmployees.fullName, departmentId: hrmsEmployees.departmentId })
        .from(hrmsEmployees)
        .where(eq(hrmsEmployees.tenantId, ctx.tenantId))
        .limit(2000),
    );
    const deptIds = [...new Set(employees.map((e) => e.departmentId))];
    const depts = deptIds.length > 0
      ? await scopedRead((tx) => tx.select({ id: hrmsDepartments.id, name: hrmsDepartments.name }).from(hrmsDepartments).where(and(eq(hrmsDepartments.tenantId, ctx.tenantId))))
      : [];
    const deptMap = new Map(depts.map((d) => [d.id, d.name]));
    return reply.send(employees.map((e) => ({ id: e.id, fullName: e.fullName, departmentName: deptMap.get(e.departmentId) ?? "" })));
  });

  // round2 review fix: payroll-service's employee-existence check (arrears/
  // bonus/reimbursements) originally reused employee-summaries above, but
  // that endpoint is `.limit(2000)` with no `.orderBy(...)` — for a tenant
  // over that size it returns an arbitrary, unordered subset, so a real
  // employeeId outside that subset would be wrongly reported as
  // nonexistent. employee-summaries' two existing callers both treat
  // incompleteness as tolerable (display enrichment, best-effort); a hard
  // reject needs an actual point lookup instead. Reuses employeeRepo.findById
  // (already tenant-scoped, RLS-safe, used by this same module's lifecycle
  // consumer and by employee/queries.ts) rather than paging through the list.
  // Returns only a boolean, not the employee record, so the internal
  // boundary doesn't leak more PII than the caller actually needs.
  app.get("/v1/hrms/internal/employees/:id/exists", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, INTERNAL_ROLES);
    const { id } = z.object({ id: z.string().uuid() }).parse(req.params);
    const emp = await employeeRepo.findById(id, ctx.tenantId);
    return reply.send({ exists: emp !== null });
  });

  // BUG-2 fix: single-employee DIC engagement LOP-applicability check.
  // payroll-service's integration/consumer.ts writes to a local LOP ledger
  // (payrollLopLedger, via lopRepo.upsertLopDays) whenever hrms-service
  // publishes hrms.attendance.marked / hrms.leave.approved -- unconditionally,
  // for every engagement type. The payroll run then PREFERS that ledger over
  // this route's own live-pull `lopDays` (see payroll/consumer.ts's "M2 LOP
  // double-count" comment) whenever any ledger row exists for the month, so a
  // ledger row written for an exempt employee (consultant/third-party/
  // apprentice) silently overrides the correct exclusion computed above by
  // `attendanceLopApplies`. Fixing this requires the SAME predicate to gate
  // the ledger write itself, at the point it happens (payroll-service's
  // consumer) -- but that's a different service/database with no direct
  // access to engagement-policy.ts or this tenant's employee row, so it asks
  // this route (via hrms-client.ts's fetchAttendanceLopApplies) rather than
  // duplicating (and risking drifting from) the resolver logic. Both this
  // route and the payroll-input route above share the exact same
  // attendanceLopApplies + loadTypeResolver from engagement-policy.ts, so the
  // two can never disagree on who is exempt.
  app.get("/v1/hrms/internal/employees/:id/attendance-lop-applies", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, INTERNAL_ROLES);
    const { id } = z.object({ id: z.string().uuid() }).parse(req.params);
    const emp = await employeeRepo.findById(id, ctx.tenantId);
    // Not found: 404, same shape as the slip-templates/default route below.
    // The caller (fetchAttendanceLopApplies) treats this status -- not a body
    // field -- as "default to true (LOP applies / not exempt)", the same
    // permissive default DEFAULT_POLICY resolves to for a type engagement-
    // typing can't classify, so a lookup miss/race never silently exempts an
    // employee it shouldn't. Distinct from unreachability, which the caller
    // must fail closed on instead of guessing.
    if (!emp) return reply.code(404).send({ code: "NOT_FOUND", message: `employee ${id} not found` });
    const resolveType = await loadTypeResolver(ctx.tenantId);
    return reply.send({ attendanceLopApplies: attendanceLopApplies(resolveType(emp.employeeType)) });
  });

  // HIGH fix (LOP-ignores-leave-type bug): single-leave-type paid/unpaid
  // classification lookup, same shape and same rationale as
  // attendance-lop-applies just above -- payroll-service's integration/
  // consumer.ts writes to the LOP ledger whenever hrms-service publishes
  // hrms.leave.approved, but that event only carries daysApplied +
  // leaveTypeId, not the leave type's own classification (a different
  // service/database, no direct access to leave/schema.ts's hrmsLeaveTypes).
  // This route and the payroll-input route above's lopFractionByTypeId both
  // read the exact same hrmsLeaveTypes.lopFractionBps column, so the two can
  // never disagree.
  app.get("/v1/hrms/internal/leave-types/:id/lop-fraction-bps", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, INTERNAL_ROLES);
    const { id } = z.object({ id: z.string().uuid() }).parse(req.params);
    const lt = await leaveRepo.findLeaveTypeById(id, ctx.tenantId);
    // Not found: 404, same contract as attendance-lop-applies above. The
    // caller (fetchLeaveLopFractionBps) must treat this status -- not a body
    // field -- as "default to 10000 (fully counts as LOP)", the same
    // fail-safe this column's own DEFAULT resolves to, so a lookup miss/race
    // never silently exempts a leave type it shouldn't. Distinct from
    // unreachability, which the caller must fail closed on instead of
    // guessing.
    if (!lt) return reply.code(404).send({ code: "NOT_FOUND", message: `leave type ${id} not found` });
    return reply.send({ lopFractionBps: lt.lopFractionBps });
  });

  // payroll-service cross-database gap fix: payroll.payroll_slip_templates
  // physically lives in this service's database (civitas_hrms — created by
  // migrations/0008_recruitment_payroll_gaps.sql) but payroll-service
  // connects to a separate civitas_payroll database with no dblink/
  // postgres_fdw link between them, so it can never query this table
  // directly. Serves the tenant's active default template over the internal
  // API instead, mirroring payroll-input/employee-summaries above. Returns
  // 404 when the tenant has no default template configured — a legitimate
  // "not configured" state, distinct from HRMS being unreachable, so the
  // caller (hrms-client.ts's fetchDefaultSlipTemplate) can tell the two
  // apart and only treat unreachability as a fall-back-worthy failure.
  app.get("/v1/hrms/internal/payroll/slip-templates/default", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, INTERNAL_ROLES);
    const { scopedRead } = await import("../../shared/db.js");
    const { payrollSlipTemplates } = await import("../payroll-config/schema.js");
    const { eq, and, desc } = await import("drizzle-orm");
    const rows = await scopedRead((tx) =>
      tx.select({
        id: payrollSlipTemplates.id,
        name: payrollSlipTemplates.name,
        templateHtml: payrollSlipTemplates.templateHtml,
        isDefault: payrollSlipTemplates.isDefault,
        footerText: payrollSlipTemplates.footerText,
      })
        .from(payrollSlipTemplates)
        .where(and(
          eq(payrollSlipTemplates.tenantId, ctx.tenantId),
          eq(payrollSlipTemplates.isDefault, true),
        ))
        .orderBy(desc(payrollSlipTemplates.createdAt))
        .limit(1),
    );
    const tpl = rows[0];
    if (!tpl) {
      return reply.code(404).send({ code: "NOT_FOUND", message: "no default payslip template configured for tenant" });
    }
    return reply.send(tpl);
  });
}
