import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { eq, sql, and } from "drizzle-orm";
import { resolveContext, requireRole } from "../../shared/context.js";
import { db } from "../../shared/db.js";
import { hrmsEmployees } from "../employee/schema.js";
import { hrmsLeaveApps } from "../leave/schema.js";
import { hrmsLeaveAllocs } from "../leave/schema.js";
import { hrmsAttendance } from "../attendance/schema.js";

const REPORT_ROLES = ["hr_admin", "super_admin", "admin", "hr_officer"];

export async function reportRoutes(app: FastifyInstance): Promise<void> {
  // Headcount by department
  app.get("/v1/hrms/reports/headcount", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, REPORT_ROLES);
    const rows = await db.select({
      departmentId: hrmsEmployees.departmentId,
      count: sql<number>`count(*)::int`,
    }).from(hrmsEmployees)
      .where(and(eq(hrmsEmployees.tenantId, ctx.tenantId), eq(hrmsEmployees.status, "confirmed")))
      .groupBy(hrmsEmployees.departmentId);
    const total = rows.reduce((s, r) => s + r.count, 0);
    return reply.send({ total, departments: rows });
  });

  // Leave balance report
  app.get("/v1/hrms/reports/leave-balance", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, REPORT_ROLES);
    const q = z.object({ fy: z.string().regex(/^\d{4}-\d{2}$/).optional() }).parse(req.query);
    const allocs = await db.select().from(hrmsLeaveAllocs)
      .where(eq(hrmsLeaveAllocs.tenantId, ctx.tenantId));
    const summary = allocs.map(a => ({
      employeeId: a.employeeId,
      leaveTypeId: a.leaveTypeId,
      fy: a.fy,
      totalDays: a.totalDays,
      balanceDays: a.balanceDays,
      usedDays: a.totalDays - a.balanceDays,
    }));
    return reply.send({ data: summary });
  });

  // Absentee report
  app.get("/v1/hrms/reports/absentees", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, REPORT_ROLES);
    const q = z.object({ month: z.string().regex(/^\d{4}-\d{2}$/).default(new Date().toISOString().slice(0, 7)) }).parse(req.query);
    const rows = await db.select().from(hrmsAttendance)
      .where(and(
        eq(hrmsAttendance.tenantId, ctx.tenantId),
        eq(hrmsAttendance.status, "absent"),
        sql`${hrmsAttendance.attendanceDate}::text LIKE ${q.month + '%'}`
      ));
    return reply.send({ month: q.month, absentCount: rows.length, records: rows.slice(0, 100).map(r => ({ employeeId: r.employeeId, date: r.attendanceDate })) });
  });

  // Seniority list
  app.get("/v1/hrms/reports/seniority", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, REPORT_ROLES);
    const employees = await db.select().from(hrmsEmployees)
      .where(and(eq(hrmsEmployees.tenantId, ctx.tenantId), eq(hrmsEmployees.status, "confirmed")))
      .orderBy(hrmsEmployees.dateOfJoining);
    return reply.send({ data: employees.map((e, i) => ({ rank: i + 1, id: e.id, name: e.fullName, designation: e.designationId, dateOfJoining: e.dateOfJoining, employeeNo: e.employeeNo })) });
  });
}
