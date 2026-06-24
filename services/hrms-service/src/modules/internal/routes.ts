import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { resolveContext, requireRole } from "../../shared/context.js";
import * as employeeRepo from "../employee/repo.js";
import * as leaveRepo from "../leave/repo.js";
import * as attendanceRepo from "../attendance/repo.js";
import { countWorkingDays } from "../leave/holidays.js";

const INTERNAL_ROLES = ["super_admin", "payroll_admin", "hr_admin"];

export async function internalRoutes(app: FastifyInstance): Promise<void> {
  app.get("/v1/hrms/internal/payroll-input", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, INTERNAL_ROLES);
    const q = z.object({ month: z.string().regex(/^\d{4}-\d{2}$/) }).parse(req.query);

    const employees = await employeeRepo.listByTenant(ctx.tenantId, 500, 0);
    const active = employees.filter((e) => e.status !== "separated");
    const approvedLeaves = await leaveRepo.findApprovedLeaveInMonth(ctx.tenantId, q.month);

    const lopByEmployee = new Map<string, number>();
    for (const leave of approvedLeaves) {
      const days = countWorkingDays(leave.fromDate, leave.toDate);
      lopByEmployee.set(leave.employeeId, (lopByEmployee.get(leave.employeeId) ?? 0) + days);
    }

    for (const emp of active) {
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
      employees: active.map((e) => ({
        id: e.id,
        employeeNo: e.employeeNo,
        fullName: e.fullName,
        basicMinor: e.basicMinor.toString(),
        payStructureId: e.payStructureId,
        bankAccountNo: e.bankAccountNo,
        bankIfsc: e.bankIfsc,
        pan: e.pan,
        uan: e.uanNumber,
        cityClass: (e.hraCityClass ?? "X") as "X" | "Y" | "Z",
        taxRegime: (e.taxRegime ?? "new") as "old" | "new",
        departmentId: e.departmentId,
        pensionScheme: (e.pensionScheme ?? "NPS") as "GPF" | "NPS" | "EPF",
      })),
      lopDays: Object.fromEntries(lopByEmployee.entries()),
    });
  });
}
