import type { FastifyInstance } from "fastify";
import { z, ZodError } from "zod";
import { eq, and } from "drizzle-orm";
import { resolveContext, HttpError } from "../../shared/context.js";
import { scopedRead} from "../../shared/db.js";
import { maskPii } from "../../shared/pii-mask.js";
import { hrmsEmployees } from "../employee/schema.js";
import { resolveEmployeeForActor, extractActorEmail } from "../employee/actor-link.js";
import { hrmsLeaveAllocs, hrmsLeaveApps } from "../leave/schema.js";
import { hrmsAttendance } from "../attendance/schema.js";

const listQuerySchema = z.object({
  limit: z.coerce.number().int().min(1).max(100).default(31),
  offset: z.coerce.number().int().min(0).default(0),
}).partial();

export async function selfServiceRoutes(app: FastifyInstance): Promise<void> {
  // My profile — employee sees their own data linked by actorId → userRef,
  // falling back to an email match (+ auto-link for next time) when not yet
  // linked. resolveEmployeeForActor is the shared source of truth for this
  // resolution — leave/routes.ts's apply-on-behalf-of checks use the same
  // function so a not-yet-linked employee doesn't get inconsistent treatment
  // depending on which endpoint they hit first.
  app.get("/v1/hrms/me/profile", async (req, reply) => {
    const ctx = resolveContext(req);
    const emp = await resolveEmployeeForActor(ctx.tenantId, ctx.actorId, extractActorEmail(req));
    if (!emp) return reply.code(404).send({ code: "NOT_FOUND", message: "No employee record linked to your user" });
    return reply.send(maskPii(emp));
  });

  // My leave balance
  app.get("/v1/hrms/me/leave-balance", async (req, reply) => {
    const ctx = resolveContext(req);
    const emps = await scopedRead((tx) => tx.select().from(hrmsEmployees)
      .where(and(eq(hrmsEmployees.tenantId, ctx.tenantId), eq(hrmsEmployees.userRef, ctx.actorId))));
    if (!emps[0]) return reply.code(404).send({ code: "NOT_FOUND", message: "No employee record" });
    const allocs = await scopedRead((tx) => tx.select().from(hrmsLeaveAllocs)
      .where(and(eq(hrmsLeaveAllocs.tenantId, ctx.tenantId), eq(hrmsLeaveAllocs.employeeId, emps[0]!.id))));
    return reply.send({ data: allocs.map(a => ({ leaveTypeId: a.leaveTypeId, fy: a.fy, total: a.totalDays, balance: a.balanceDays, used: a.totalDays - a.balanceDays })) });
  });

  // My attendance this month
  app.get("/v1/hrms/me/attendance", async (req, reply) => {
    const ctx = resolveContext(req);
    const query = listQuerySchema.parse(req.query);
    const emps = await scopedRead((tx) => tx.select().from(hrmsEmployees)
      .where(and(eq(hrmsEmployees.tenantId, ctx.tenantId), eq(hrmsEmployees.userRef, ctx.actorId))));
    if (!emps[0]) return reply.code(404).send({ code: "NOT_FOUND", message: "No employee record" });
    const records = await scopedRead((tx) => tx.select().from(hrmsAttendance)
      .where(and(eq(hrmsAttendance.tenantId, ctx.tenantId), eq(hrmsAttendance.employeeId, emps[0]!.id))));
    return reply.send({ data: records.slice(0, query.limit ?? 31).map(r => ({ date: r.attendanceDate, status: r.status, inTime: r.inTime, outTime: r.outTime })) });
  });

  // My leave applications
  app.get("/v1/hrms/me/leave-applications", async (req, reply) => {
    const ctx = resolveContext(req);
    const emps = await scopedRead((tx) => tx.select().from(hrmsEmployees)
      .where(and(eq(hrmsEmployees.tenantId, ctx.tenantId), eq(hrmsEmployees.userRef, ctx.actorId))));
    if (!emps[0]) return reply.code(404).send({ code: "NOT_FOUND", message: "No employee record" });
    const apps = await scopedRead((tx) => tx.select().from(hrmsLeaveApps)
      .where(and(eq(hrmsLeaveApps.tenantId, ctx.tenantId), eq(hrmsLeaveApps.employeeId, emps[0]!.id))));
    return reply.send({ data: apps.map(a => ({ id: a.id, leaveTypeId: a.leaveTypeId, fromDate: a.fromDate, toDate: a.toDate, days: a.daysApplied, status: a.status })) });
  });

  app.setErrorHandler((err, req, reply) => {
    const correlationId = (req.headers["x-correlation-id"] as string) ?? req.id;
    if (err instanceof ZodError) { return reply.code(400).send({ code: "VALIDATION_FAILED", message: "invalid request", correlationId, retryable: false, fieldErrors: err.issues.map((i) => ({ field: i.path.join("."), message: i.message })) }); }
    if (err instanceof HttpError) { return reply.code(err.status).send({ code: err.code, message: err.message, correlationId, retryable: false }); }
    req.log.error({ err }, "unhandled error");
    return reply.code(500).send({ code: "INTERNAL", message: "internal error", correlationId, retryable: true });
  });
}
