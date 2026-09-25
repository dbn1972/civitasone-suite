import type { FastifyInstance } from "fastify";
import { z, ZodError } from "zod";
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
      // HIGH fix (leave-balance negative-number bug): this used to omit
      // totalDays entirely, forcing the frontend (LeaveBalanceClient.tsx) to
      // fall back to the leave TYPE's generic policy cap (maxDays, e.g. "EL:
      // 30 days/year for this tenant") as the denominator for "days used".
      // maxDays is not this employee's actual granted allocation for the
      // year -- hrmsLeaveAllocs.totalDays is (set explicitly per employee
      // per fy at allocation time, see commands.ts's allocateLeave; pro-rated
      // for new joiners, carried-forward, or HR-adjusted, so it can be
      // higher OR lower than the generic maxDays). Whenever an employee's
      // real totalDays exceeded the type's maxDays, "used = maxDays -
      // balanceDays" went negative (observed live as "Total Used: -4d").
      // totalDays already exists on hrmsLeaveAllocs and repo.listAllocsForEmployee
      // already selects the full row -- it was simply never sent.
      allocations: allocs.map((a) => ({
        id: a.id,
        leaveTypeId: a.leaveTypeId,
        leaveTypeCode: typeMap.get(a.leaveTypeId)?.code ?? "",
        leaveTypeName: typeMap.get(a.leaveTypeId)?.name ?? "",
        fy: a.fy,
        totalDays: a.totalDays,
        balanceDays: a.balanceDays,
      })),
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
}
