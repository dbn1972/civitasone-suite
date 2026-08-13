import type { FastifyInstance } from "fastify";
import { ZodError } from "zod";
import { HRDashboardSchema } from "@civitasone/schemas/web";
import { sendValidated } from "@civitasone/schemas/validate";
import { resolveContext, requireRole, HttpError } from "../../shared/context.js";
import { z } from "zod";
import * as queries from "./queries.js";

const READER_ROLES = ["hr_admin", "hr_officer", "super_admin", "manager"];

const PendingLeaveInboxItemSchema = z.object({
  id: z.string(),
  employeeName: z.string(),
  employeeNo: z.string(),
  departmentName: z.string(),
  leaveTypeName: z.string(),
  leaveTypeCode: z.string(),
  fromDate: z.string(),
  toDate: z.string(),
  daysApplied: z.number(),
  status: z.string(),
});
const PendingLeaveInboxSchema = z.object({ data: z.array(PendingLeaveInboxItemSchema) });

export async function dashboardRoutes(app: FastifyInstance): Promise<void> {
  app.get("/v1/hrms/dashboard", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, READER_ROLES);
    sendValidated(reply, HRDashboardSchema, await queries.getDashboard(ctx.tenantId));
  });

  app.get("/v1/hrms/dashboard/pending-leaves", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, READER_ROLES);
    const items = await queries.getPendingLeaveInbox(ctx.tenantId);
    sendValidated(reply, PendingLeaveInboxSchema, { data: items });
  });

  app.setErrorHandler((err, req, reply) => {
    const correlationId = (req.headers["x-correlation-id"] as string) ?? req.id;
    if (err instanceof ZodError) { return reply.code(400).send({ code: "VALIDATION_FAILED", message: "invalid request", correlationId, retryable: false, fieldErrors: err.issues.map((i) => ({ field: i.path.join("."), message: i.message })) }); }
    if (err instanceof HttpError) { return reply.code(err.status).send({ code: err.code, message: err.message, correlationId, retryable: false }); }
    req.log.error({ err }, "unhandled error");
    return reply.code(500).send({ code: "INTERNAL", message: "internal error", correlationId, retryable: true });
  });
}
