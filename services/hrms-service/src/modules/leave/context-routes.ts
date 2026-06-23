import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { resolveContext, requireRole, HttpError } from "../../shared/context.js";
import * as repo from "./repo.js";
import * as employeeRepo from "../employee/repo.js";

const ALL_ROLES = ["hr_admin", "hr_officer", "super_admin", "manager", "employee"];

export async function leaveContextRoutes(app: FastifyInstance): Promise<void> {
  app.get("/v1/hrms/leave-context", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, ALL_ROLES);
    const q = z.object({ employeeId: z.string().uuid() }).parse(req.query);
    const employee = await employeeRepo.findById(q.employeeId, ctx.tenantId);
    if (!employee) throw new HttpError(404, "NOT_FOUND", "employee not found");

    const types = await repo.listLeaveTypesByTenant(ctx.tenantId);
    const allocs = await repo.listAllocsForEmployee(ctx.tenantId, q.employeeId);
    const typeMap = new Map(types.map((t) => [t.id, t]));

    return reply.send({
      employee: {
        id: employee.id,
        employeeNo: employee.employeeNo,
        name: employee.fullName,
      },
      leaveTypes: types.map((t) => ({ id: t.id, code: t.code, name: t.name, maxDays: t.maxDays })),
      allocations: allocs.map((a) => ({
        id: a.id,
        leaveTypeId: a.leaveTypeId,
        leaveTypeCode: typeMap.get(a.leaveTypeId)?.code ?? "",
        leaveTypeName: typeMap.get(a.leaveTypeId)?.name ?? "",
        fy: a.fy,
        balanceDays: a.balanceDays,
      })),
    });
  });
}
