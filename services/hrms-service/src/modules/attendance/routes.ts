import type { FastifyInstance } from "fastify";
import { ZodError, z } from "zod";
import { acceptedResponseSchema, listQuerySchema } from "@civitasone/schemas/common";
import { attendanceSummaryResponseSchema, AttendanceRegularisationListSchema, AttendanceSummaryListSchema } from "@civitasone/schemas/web";
import {sendValidated, sendAccepted } from "@civitasone/schemas/validate";
import { resolveContext, requireRole, HttpError } from "../../shared/context.js";
import { markAttendanceBody } from "./validators.js";
import * as commands from "./commands.js";
import * as queries from "./queries.js";

const HR_ROLES  = ["hr_admin", "hr_officer", "super_admin"];
const ALL_ROLES = [...HR_ROLES, "manager"];

export async function attendanceRoutes(app: FastifyInstance): Promise<void> {
  app.post("/v1/hrms/attendance", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, HR_ROLES);
    const body = markAttendanceBody.parse(req.body);
    return sendAccepted(reply, acceptedResponseSchema, await commands.markAttendance(ctx, body));
  });

  app.get("/v1/hrms/attendance/summary", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, ALL_ROLES);
    const q = z.object({ month: z.string().regex(/^\d{4}-\d{2}$/).default(new Date().toISOString().slice(0, 7)) }).parse(req.query);
    sendValidated(reply, attendanceSummaryResponseSchema, {
      data: [{ date: `${q.month}-01`, presentCount: 0, absentCount: 0, lateCount: 0 }],
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

  app.get("/v1/hrms/attendance/regularisations", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, ALL_ROLES);
    const q = listQuerySchema.parse(req.query);
    sendValidated(reply, AttendanceRegularisationListSchema, await queries.listRegularisations(ctx.tenantId, q.limit));
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
