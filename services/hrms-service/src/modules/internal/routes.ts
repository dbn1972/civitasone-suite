import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { resolveContext, requireRole } from "../../shared/context.js";
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
}
