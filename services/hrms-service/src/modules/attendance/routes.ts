import { randomUUID } from "node:crypto";
import type { FastifyInstance } from "fastify";
import { ZodError, z } from "zod";
import { acceptedResponseSchema, listQuerySchema } from "@civitasone/schemas/common";
import { attendanceSummaryResponseSchema, AttendanceRegularisationListSchema, AttendanceSummaryListSchema } from "@civitasone/schemas/web";
import {sendValidated, sendAccepted } from "@civitasone/schemas/validate";
import { resolveContext, requireRole, HttpError } from "../../shared/context.js";
import { publishF3Write } from "../../shared/f3-publish.js";
import { markAttendanceBody, regularisationCreateBody, periodLockBody } from "./validators.js";
import * as commands from "./commands.js";
import * as queries from "./queries.js";
import * as repo from "./repo.js";
import * as employeeRepo from "../employee/repo.js";
import { db, scopedRead } from "../../shared/db.js";
import { hrmsOvertimeRequests, hrmsWfhRequests, hrmsShiftChangeRequests, hrmsAttendanceRegularisations } from "./schema.js";
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
    z.object({ reason: z.string().max(500).optional() }).parse(req.body ?? {});

    // Synchronous pre-check: the old code atomically updated WHERE status='pending'
    // and 404'd when the regularisation was missing or already decided. The async
    // consumer applies the same guarded update, but that check must also run here —
    // otherwise an invalid/duplicate approve would get a false-positive 202 while
    // the write is silently skipped.
    const existing = await scopedRead((tx) =>
      tx.select({ id: hrmsAttendanceRegularisations.id, status: hrmsAttendanceRegularisations.status })
        .from(hrmsAttendanceRegularisations)
        .where(and(eq(hrmsAttendanceRegularisations.id, id), eq(hrmsAttendanceRegularisations.tenantId, ctx.tenantId)))
        .limit(1),
    );
    if (!existing[0] || existing[0].status !== "pending") {
      throw new HttpError(404, "NOT_FOUND", "regularisation not found or already decided");
    }

    await publishF3Write(ctx, "attendance_routes__0", id, { body: (req.body as Record<string, unknown>) ?? {}, params: req.params as Record<string, unknown>, query: req.query as Record<string, unknown> });
    return reply.code(202).send({ id, status: "approved" }) as any;
  });

  app.post("/v1/hrms/attendance/regularisations/:id/reject", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, HR_ROLES);
    const { id } = z.object({ id: z.string().uuid() }).parse(req.params);
    z.object({ reason: z.string().min(1).max(500) }).parse(req.body ?? {});

    // Synchronous pre-check — same reasoning as the approve route above: mirror
    // the consumer's WHERE status='pending' guard so a bad/duplicate reject 404s
    // synchronously instead of silently no-op'ing after a false 202.
    const existing = await scopedRead((tx) =>
      tx.select({ id: hrmsAttendanceRegularisations.id, status: hrmsAttendanceRegularisations.status })
        .from(hrmsAttendanceRegularisations)
        .where(and(eq(hrmsAttendanceRegularisations.id, id), eq(hrmsAttendanceRegularisations.tenantId, ctx.tenantId)))
        .limit(1),
    );
    if (!existing[0] || existing[0].status !== "pending") {
      throw new HttpError(404, "NOT_FOUND", "regularisation not found or already decided");
    }

    await publishF3Write(ctx, "attendance_routes__1", id, { body: (req.body as Record<string, unknown>) ?? {}, params: req.params as Record<string, unknown>, query: req.query as Record<string, unknown> });
    return reply.code(202).send({ id, status: "rejected" }) as any;
  });

  // Shifts list (hrmsShifts table)
  app.get("/v1/hrms/shifts", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, ALL_ROLES);
    return reply.send({ data: await repo.listShifts(ctx.tenantId) });
  });

  app.get("/v1/hrms/shift-requests", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, [...HR_ROLES, "manager"]);
    const rows = await db.select().from(hrmsShiftChangeRequests)
      .where(eq(hrmsShiftChangeRequests.tenantId, ctx.tenantId))
      .orderBy(desc(hrmsShiftChangeRequests.createdAt))
      .limit(200);
    const employees = await employeeRepo.listByTenant(ctx.tenantId, 500, 0);
    const empMap = new Map(employees.map((e) => [e.id, e]));
    return reply.send({ data: rows.map((r) => ({
      id: r.id,
      employeeId: r.employeeId,
      employeeName: empMap.get(r.employeeId)?.fullName ?? r.employeeId.slice(0, 8),
      currentShift: r.currentShift,
      requestedShift: r.requestedShift,
      effectiveDate: r.effectiveDate,
      reason: r.reason ?? null,
      status: r.status,
      createdAt: r.createdAt instanceof Date ? r.createdAt.toISOString() : String(r.createdAt),
    })) });
  });

  app.get("/v1/hrms/wfh-requests", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, [...HR_ROLES, "manager"]);
    const rows = await db.select().from(hrmsWfhRequests)
      .where(eq(hrmsWfhRequests.tenantId, ctx.tenantId))
      .orderBy(desc(hrmsWfhRequests.createdAt))
      .limit(200);
    const employees = await employeeRepo.listByTenant(ctx.tenantId, 500, 0);
    const empMap = new Map(employees.map((e) => [e.id, e]));
    return reply.send({ data: rows.map((r) => ({
      id: r.id,
      employeeId: r.employeeId,
      employeeName: empMap.get(r.employeeId)?.fullName ?? r.employeeId.slice(0, 8),
      fromDate: r.fromDate,
      toDate: r.toDate,
      reason: r.reason ?? null,
      status: r.status,
      createdAt: r.createdAt instanceof Date ? r.createdAt.toISOString() : String(r.createdAt),
    })) });
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
    // IDOR guard: employees may only submit OT requests for themselves
    const isHrActor = HR_ROLES.some((r) => ctx.roles.includes(r));
    if (!isHrActor && body.employeeId !== ctx.actorId) {
      throw new HttpError(403, "FORBIDDEN", "employees may only create overtime requests for themselves");
    }
    const id = randomUUID();
    await publishF3Write(ctx, "attendance_routes__2", id, { body: (req.body as Record<string, unknown>) ?? {}, params: req.params as Record<string, unknown>, query: req.query as Record<string, unknown> });
    return reply.code(202).send({ id, status: "pending" }) as any;
  });

  app.get("/v1/hrms/overtime-requests", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, [...HR_ROLES, "employee", "manager"]);
    const q = z.object({ empId: z.string().uuid().optional() }).parse(req.query);
    // IDOR guard: employees may only read their own OT requests
    const isHrOrManager = [...HR_ROLES, "manager"].some((r) => ctx.roles.includes(r));
    const effectiveEmpId = isHrOrManager ? q.empId : ctx.actorId;
    const rows = await db.select().from(hrmsOvertimeRequests)
      .where(and(
        eq(hrmsOvertimeRequests.tenantId, ctx.tenantId),
        effectiveEmpId ? eq(hrmsOvertimeRequests.employeeId, effectiveEmpId) : undefined,
      ))
      .orderBy(desc(hrmsOvertimeRequests.requestDate))
      .limit(200);
    return reply.send({ data: rows });
  });

  app.patch("/v1/hrms/overtime-requests/:id/approve", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, HR_ROLES);
    const { id } = z.object({ id: z.string().uuid() }).parse(req.params);

    // Synchronous pre-check (existence): the old code's conditional UPDATE
    // WHERE id+tenantId 404'd when no row matched. Mirror that here so an
    // invalid id gets a real 404 instead of a silently dropped async write.
    const existing = await scopedRead((tx) =>
      tx.select({ id: hrmsOvertimeRequests.id }).from(hrmsOvertimeRequests)
        .where(and(eq(hrmsOvertimeRequests.id, id), eq(hrmsOvertimeRequests.tenantId, ctx.tenantId)))
        .limit(1),
    );
    if (!existing[0]) return reply.code(404).send({ error: "Overtime request not found" });

    await publishF3Write(ctx, "attendance_routes__3", id, { body: (req.body as Record<string, unknown>) ?? {}, params: req.params as Record<string, unknown>, query: req.query as Record<string, unknown> });
    return reply.code(202).send({ id, status: "approved" }) as any;
  });

  app.patch("/v1/hrms/overtime-requests/:id/reject", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, HR_ROLES);
    const { id } = z.object({ id: z.string().uuid() }).parse(req.params);
    z.object({ reason: z.string().max(500).optional() }).parse(req.body);

    // Synchronous pre-check (existence) — same reasoning as the approve route.
    const existing = await scopedRead((tx) =>
      tx.select({ id: hrmsOvertimeRequests.id }).from(hrmsOvertimeRequests)
        .where(and(eq(hrmsOvertimeRequests.id, id), eq(hrmsOvertimeRequests.tenantId, ctx.tenantId)))
        .limit(1),
    );
    if (!existing[0]) return reply.code(404).send({ error: "Overtime request not found" });

    await publishF3Write(ctx, "attendance_routes__4", id, { body: (req.body as Record<string, unknown>) ?? {}, params: req.params as Record<string, unknown>, query: req.query as Record<string, unknown> });
    return reply.code(202).send({ id, status: "rejected" }) as any;
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
