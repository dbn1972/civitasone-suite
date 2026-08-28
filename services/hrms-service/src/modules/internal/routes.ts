import type { FastifyInstance } from "fastify";
import { z, ZodError } from "zod";
import { resolveContext, requireRole, HttpError } from "../../shared/context.js";
import * as employeeRepo from "../employee/repo.js";
import * as leaveRepo from "../leave/repo.js";
import * as attendanceRepo from "../attendance/repo.js";
import { countWorkingDays } from "../leave/holidays.js";
import { activePaySuspendedEmployeeIds } from "../disciplinary/repo.js";
import { loadTypeResolver, attendanceLopApplies } from "../employee/engagement-policy.js";

const INTERNAL_ROLES = ["super_admin", "payroll_admin", "hr_admin"];

export async function internalRoutes(app: FastifyInstance): Promise<void> {
  app.get("/v1/hrms/internal/payroll-input", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, INTERNAL_ROLES);
    const q = z.object({ month: z.string().regex(/^\d{4}-\d{2}$/) }).parse(req.query);

    const employees = await employeeRepo.listByTenant(ctx.tenantId, 500, 0);
    const active = employees.filter((e) => e.status !== "separated");
    // DIC engagement policy per employee (payroll excludes non-salary types +
    // gates statutory). Resolver = tenant type master over canonical catalogue.
    const resolveType = await loadTypeResolver(ctx.tenantId);
    const approvedLeaves = await leaveRepo.findApprovedLeaveInMonth(ctx.tenantId, q.month);
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

    const lopByEmployee = new Map<string, number>();
    for (const leave of approvedLeaves) {
      if (noSalaryLop.has(leave.employeeId)) continue;
      const days = countWorkingDays(leave.fromDate, leave.toDate);
      lopByEmployee.set(leave.employeeId, (lopByEmployee.get(leave.employeeId) ?? 0) + days);
    }

    for (const emp of active) {
      if (noSalaryLop.has(emp.id)) continue;
      const attRows = await attendanceRepo.findByEmpAndMonth(ctx.tenantId, emp.id, q.month);
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
    });
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
  app.get("/v1/hrms/internal/employee-summaries", async (req, reply) => {
    const headers = req.headers as Record<string, string>;
    const tenantId = headers["x-tenant-id"] ?? "";
    if (!tenantId) return reply.code(400).send({ code: "MISSING_TENANT" });
    const { scopedRead } = await import("../../shared/db.js");
    const { hrmsEmployees, hrmsDepartments } = await import("../employee/schema.js");
    const { eq, and } = await import("drizzle-orm");
    const employees = await scopedRead((tx) =>
      tx.select({ id: hrmsEmployees.id, fullName: hrmsEmployees.fullName, departmentId: hrmsEmployees.departmentId })
        .from(hrmsEmployees)
        .where(eq(hrmsEmployees.tenantId, tenantId))
        .limit(2000),
    );
    const deptIds = [...new Set(employees.map((e) => e.departmentId))];
    const depts = deptIds.length > 0
      ? await scopedRead((tx) => tx.select({ id: hrmsDepartments.id, name: hrmsDepartments.name }).from(hrmsDepartments).where(and(eq(hrmsDepartments.tenantId, tenantId))))
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
}
