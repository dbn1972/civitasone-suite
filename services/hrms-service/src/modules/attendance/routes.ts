import type { FastifyInstance } from "fastify";
import { ZodError, z } from "zod";
import { acceptedResponseSchema, listQuerySchema } from "@civitasone/schemas/common";
import { attendanceSummaryResponseSchema, AttendanceRegularisationListSchema, AttendanceSummaryListSchema } from "@civitasone/schemas/web";
import {sendValidated, sendAccepted } from "@civitasone/schemas/validate";
import { resolveContext, requireRole, HttpError } from "../../shared/context.js";
import { markAttendanceBody, regularisationCreateBody, periodLockBody } from "./validators.js";
import * as commands from "./commands.js";
import * as queries from "./queries.js";
import * as repo from "./repo.js";
import { db } from "../../shared/db.js";
import { hrmsOvertimeRequests } from "./schema.js";
import { eq, and, desc } from "drizzle-orm";

const HR_ROLES  = ["hr_admin", "hr_officer", "super_admin"];
const ALL_ROLES = [...HR_ROLES, "manager"];
const LOCK_ROLES = ["hr_admin", "super_admin"];

async function assertPeriodsUnlocked(tenantId: string, dates: string[]): Promise<void> {
  const periods = Array.from(new Set(dates.map((d) => d.slice(0, 7))));
  const locked = await repo.findLockedPeriods(tenantId, periods);
  if (locked.length > 0) {
    throw new HttpError(
      422,
      "ATTENDANCE_LOCKED",
      `attendance period(s) ${locked.sort().join(", ")} are locked (payroll cut-off) — reopen the period before editing`,
    );
  }
}

export async function attendanceRoutes(app: FastifyInstance): Promise<void> {
  app.post("/v1/hrms/attendance", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, HR_ROLES);
    const body = markAttendanceBody.parse(req.body);
    await assertPeriodsUnlocked(ctx.tenantId, body.records.map((r) => r.attendanceDate));
    return sendAccepted(reply, acceptedResponseSchema, await commands.markAttendance(ctx, body));
  });

  app.get("/v1/hrms/attendance/locks", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, ALL_ROLES);
    return reply.send({ data: await queries.listAttendanceLocks(ctx.tenantId) });
  });

  app.post("/v1/hrms/attendance/locks", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, LOCK_ROLES);
    const body = periodLockBody.parse(req.body);
    return sendAccepted(reply, acceptedResponseSchema, await commands.lockPeriod(ctx, body));
  });

  app.post("/v1/hrms/attendance/locks/unlock", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, LOCK_ROLES);
    const body = periodLockBody.parse(req.body);
    return sendAccepted(reply, acceptedResponseSchema, await commands.unlockPeriod(ctx, body));
  });

  app.get("/v1/hrms/attendance/summary", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, ALL_ROLES);
    const q = z.object({ month: z.string().regex(/^\d{4}-\d{2}$/).default(new Date().toISOString().slice(0, 7)) }).parse(req.query);
    sendValidated(reply, attendanceSummaryResponseSchema, {
      data: await queries.getAttendanceSummaryForMonth(ctx.tenantId, q.month),
    });
  });

  app.get("/v1/hrms/attendance", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, ALL_ROLES);
    const q = listQuerySchema.extend({
      empId: z.string().uuid().optional(),
      month: z.string().regex(/^\d{4}-\d{2}$/).optional(),
    }).parse(req.query);
    if (q.empId && q.month) {
      return reply.send(await queries.getAttendanceByEmpAndMonth(ctx.tenantId, q.empId, q.month));
    }
    sendValidated(reply, AttendanceSummaryListSchema, await queries.listAttendance(ctx.tenantId, q.limit));
  });

  app.get("/v1/hrms/attendance/checkin-log", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, ALL_ROLES);
    const q = z.object({ limit: z.coerce.number().int().min(1).max(500).default(200) }).parse(req.query);
    return reply.send({ data: await repo.listCheckinLog(ctx.tenantId, q.limit) });
  });

  app.get("/v1/hrms/attendance/regularisations", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, ALL_ROLES);
    const q = listQuerySchema.parse(req.query);
    sendValidated(reply, AttendanceRegularisationListSchema, await queries.listRegularisations(ctx.tenantId, q.limit));
  });

  app.post("/v1/hrms/attendance/regularisations", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, ALL_ROLES);
    const body = regularisationCreateBody.parse(req.body);
    await assertPeriodsUnlocked(ctx.tenantId, [body.date]);
    return sendAccepted(reply, acceptedResponseSchema, await commands.createRegularisation(ctx, body));
  });

  // PPL-D1 fix: approve / reject a pending regularisation
  app.post("/v1/hrms/attendance/regularisations/:id/approve", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, HR_ROLES);
    const { id } = z.object({ id: z.string().uuid() }).parse(req.params);
    const { reason } = z.object({ reason: z.string().max(500).optional() }).parse(req.body ?? {});
    const ok = await repo.updateRegularisationStatus(ctx.tenantId, id, "approved", ctx.actorId, reason);
    if (!ok) throw new HttpError(404, "NOT_FOUND", "regularisation not found or already decided");
    return reply.send({ id, status: "approved" });
  });

  app.post("/v1/hrms/attendance/regularisations/:id/reject", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, HR_ROLES);
    const { id } = z.object({ id: z.string().uuid() }).parse(req.params);
    const { reason } = z.object({ reason: z.string().min(1).max(500) }).parse(req.body ?? {});
    const ok = await repo.updateRegularisationStatus(ctx.tenantId, id, "rejected", ctx.actorId, reason);
    if (!ok) throw new HttpError(404, "NOT_FOUND", "regularisation not found or already decided");
    return reply.send({ id, status: "rejected" });
  });

  // Shifts list (hrmsShifts table)
  app.get("/v1/hrms/shifts", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, ALL_ROLES);
    return reply.send({ data: await repo.listShifts(ctx.tenantId) });
  });

  // Shift-requests and WFH-requests: return empty until DB tables are built
  app.get("/v1/hrms/shift-requests", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, ALL_ROLES);
    return reply.send({ data: [] });
  });

  app.get("/v1/hrms/wfh-requests", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, ALL_ROLES);
    return reply.send({ data: [] });
  });

  // ── Overtime requests ───────────────────────────────────────────────────
  app.post("/v1/hrms/overtime-requests", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, [...HR_ROLES, "employee"]);
    const body = z.object({
      employeeId:     z.string().uuid(),
      requestDate:    z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
      hoursRequested: z.number().min(0.5).max(24),
      reason:         z.string().max(500).optional(),
    }).parse(req.body);
    const rows = await db.insert(hrmsOvertimeRequests).values({
      tenantId: ctx.tenantId, employeeId: body.employeeId,
      requestDate: body.requestDate, hoursRequested: String(body.hoursRequested),
      reason: body.reason ?? null, createdBy: ctx.actorId, updatedBy: ctx.actorId,
    }).returning();
    const row = rows[0];
    if (!row) throw new HttpError(500, "INSERT_FAILED", "overtime insert returned no row");
    return reply.code(201).send({ id: row.id, status: row.status });
  });

  app.get("/v1/hrms/overtime-requests", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, [...HR_ROLES, "employee", "manager"]);
    const q = z.object({ empId: z.string().uuid().optional() }).parse(req.query);
    const rows = await db.select().from(hrmsOvertimeRequests)
      .where(and(
        eq(hrmsOvertimeRequests.tenantId, ctx.tenantId),
        q.empId ? eq(hrmsOvertimeRequests.employeeId, q.empId) : undefined,
      ))
      .orderBy(desc(hrmsOvertimeRequests.requestDate))
      .limit(200);
    return reply.send({ data: rows });
  });

  app.patch("/v1/hrms/overtime-requests/:id/approve", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, HR_ROLES);
    const { id } = z.object({ id: z.string().uuid() }).parse(req.params);
    await db.update(hrmsOvertimeRequests)
      .set({ status: "approved", approvedBy: ctx.actorId, approvedAt: new Date(),
             updatedBy: ctx.actorId, updatedAt: new Date() })
      .where(and(eq(hrmsOvertimeRequests.id, id), eq(hrmsOvertimeRequests.tenantId, ctx.tenantId)));
    return reply.send({ id, status: "approved" });
  });

  app.patch("/v1/hrms/overtime-requests/:id/reject", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, HR_ROLES);
    const { id } = z.object({ id: z.string().uuid() }).parse(req.params);
    const { reason } = z.object({ reason: z.string().max(500).optional() }).parse(req.body);
    await db.update(hrmsOvertimeRequests)
      .set({ status: "rejected", rejectionReason: reason ?? null,
             updatedBy: ctx.actorId, updatedAt: new Date() })
      .where(and(eq(hrmsOvertimeRequests.id, id), eq(hrmsOvertimeRequests.tenantId, ctx.tenantId)));
    return reply.send({ id, status: "rejected" });
  });

  app.setErrorHandler(errorHandler);
}

function errorHandler(err: unknown, req: any, reply: any): void {
  const correlationId = (req.headers["x-correlation-id"] as string) ?? req.id;
  if (err instanceof ZodError) {
    void reply.code(400).send({ code: "VALIDATION_FAILED", message: "invalid request", correlationId, retryable: false, fieldErrors: err.issues.map((i) => ({ field: i.path.join("."), message: i.message })) });
    return;
  }
  if (err instanceof HttpError) {
    void reply.code(err.status).send({ code: err.code, message: err.message, correlationId, retryable: false });
    return;
  }
  req.log.error({ err }, "unhandled error");
  void reply.code(500).send({ code: "INTERNAL", message: "internal error", correlationId, retryable: true });
}
