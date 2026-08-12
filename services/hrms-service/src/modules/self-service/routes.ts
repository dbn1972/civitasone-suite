import type { FastifyInstance, FastifyRequest } from "fastify";
import { z, ZodError } from "zod";
import { eq, and } from "drizzle-orm";
import { resolveContext, HttpError } from "../../shared/context.js";
import { db, scopedRead} from "../../shared/db.js";
import { hrmsEmployees } from "../employee/schema.js";
import { hrmsLeaveAllocs, hrmsLeaveApps } from "../leave/schema.js";
import { hrmsAttendance } from "../attendance/schema.js";

/** Extract email from the decoded JWT payload attached by authPlugin. */
function extractEmail(req: FastifyRequest): string | undefined {
  const raw = (req as unknown as { jwtPayload?: { email?: string } }).jwtPayload;
  if (raw?.email) return raw.email;
  // Fallback: check x-user-email header forwarded by gateway
  const hdr = req.headers["x-user-email"];
  return typeof hdr === "string" ? hdr : undefined;
}

const listQuerySchema = z.object({
  limit: z.coerce.number().int().min(1).max(100).default(31),
  offset: z.coerce.number().int().min(0).default(0),
}).partial();

export async function selfServiceRoutes(app: FastifyInstance): Promise<void> {
  // My profile — employee sees their own data linked by actorId → userRef.
  // Fallback: if no userRef match, try matching by email from JWT claims and
  // auto-link for next time (solves the bootstrap problem where employees are
  // seeded without user_ref populated).
  app.get("/v1/hrms/me/profile", async (req, reply) => {
    const ctx = resolveContext(req);
    // Primary lookup: userRef = actorId
    let rows = await scopedRead((tx) => tx.select().from(hrmsEmployees)
      .where(and(eq(hrmsEmployees.tenantId, ctx.tenantId), eq(hrmsEmployees.userRef, ctx.actorId))));
    let emp = rows[0];

    // Fallback: match by email from JWT if userRef is not linked yet
    if (!emp) {
      const email = extractEmail(req);
      if (email) {
        rows = await scopedRead((tx) => tx.select().from(hrmsEmployees)
          .where(and(eq(hrmsEmployees.tenantId, ctx.tenantId), eq(hrmsEmployees.email, email))));
        emp = rows[0];
        if (emp) {
          // Auto-link userRef so future lookups are fast
          await db.update(hrmsEmployees)
            .set({ userRef: ctx.actorId })
            .where(and(eq(hrmsEmployees.id, emp.id), eq(hrmsEmployees.tenantId, ctx.tenantId)));
        }
      }
    }

    if (!emp) return reply.code(404).send({ code: "NOT_FOUND", message: "No employee record linked to your user" });
    return reply.send(emp);
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
