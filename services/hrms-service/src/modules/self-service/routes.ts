import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { eq, and } from "drizzle-orm";
import { resolveContext } from "../../shared/context.js";
import { db } from "../../shared/db.js";
import { hrmsEmployees } from "../employee/schema.js";
import { hrmsLeaveAllocs, hrmsLeaveApps } from "../leave/schema.js";
import { hrmsAttendance } from "../attendance/schema.js";

const listQuerySchema = z.object({
  limit: z.coerce.number().int().min(1).max(100).default(31),
  offset: z.coerce.number().int().min(0).default(0),
}).partial();

export async function selfServiceRoutes(app: FastifyInstance): Promise<void> {
  // My profile — employee sees their own data linked by actorId → userRef
  app.get("/v1/hrms/me/profile", async (req, reply) => {
    const ctx = resolveContext(req);
    const rows = await db.select().from(hrmsEmployees)
      .where(and(eq(hrmsEmployees.tenantId, ctx.tenantId), eq(hrmsEmployees.userRef, ctx.actorId)));
    const emp = rows[0];
    if (!emp) return reply.code(404).send({ code: "NOT_FOUND", message: "No employee record linked to your user" });
    return reply.send(emp);
  });

  // My leave balance
  app.get("/v1/hrms/me/leave-balance", async (req, reply) => {
    const ctx = resolveContext(req);
    const emps = await db.select().from(hrmsEmployees)
      .where(and(eq(hrmsEmployees.tenantId, ctx.tenantId), eq(hrmsEmployees.userRef, ctx.actorId)));
    if (!emps[0]) return reply.code(404).send({ code: "NOT_FOUND", message: "No employee record" });
    const allocs = await db.select().from(hrmsLeaveAllocs)
      .where(and(eq(hrmsLeaveAllocs.tenantId, ctx.tenantId), eq(hrmsLeaveAllocs.employeeId, emps[0].id)));
    return reply.send({ data: allocs.map(a => ({ leaveTypeId: a.leaveTypeId, fy: a.fy, total: a.totalDays, balance: a.balanceDays, used: a.totalDays - a.balanceDays })) });
  });

  // My attendance this month
  app.get("/v1/hrms/me/attendance", async (req, reply) => {
    const ctx = resolveContext(req);
    const query = listQuerySchema.parse(req.query);
    const emps = await db.select().from(hrmsEmployees)
      .where(and(eq(hrmsEmployees.tenantId, ctx.tenantId), eq(hrmsEmployees.userRef, ctx.actorId)));
    if (!emps[0]) return reply.code(404).send({ code: "NOT_FOUND", message: "No employee record" });
    const records = await db.select().from(hrmsAttendance)
      .where(and(eq(hrmsAttendance.tenantId, ctx.tenantId), eq(hrmsAttendance.employeeId, emps[0].id)));
    return reply.send({ data: records.slice(0, query.limit ?? 31).map(r => ({ date: r.attendanceDate, status: r.status, inTime: r.inTime, outTime: r.outTime })) });
  });

  // My leave applications
  app.get("/v1/hrms/me/leave-applications", async (req, reply) => {
    const ctx = resolveContext(req);
    const emps = await db.select().from(hrmsEmployees)
      .where(and(eq(hrmsEmployees.tenantId, ctx.tenantId), eq(hrmsEmployees.userRef, ctx.actorId)));
    if (!emps[0]) return reply.code(404).send({ code: "NOT_FOUND", message: "No employee record" });
    const apps = await db.select().from(hrmsLeaveApps)
      .where(and(eq(hrmsLeaveApps.tenantId, ctx.tenantId), eq(hrmsLeaveApps.employeeId, emps[0].id)));
    return reply.send({ data: apps.map(a => ({ id: a.id, leaveTypeId: a.leaveTypeId, fromDate: a.fromDate, toDate: a.toDate, days: a.daysApplied, status: a.status })) });
  });
}
