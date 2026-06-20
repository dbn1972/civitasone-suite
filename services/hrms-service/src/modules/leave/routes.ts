import type { FastifyInstance } from "fastify";
import { ZodError, z } from "zod";
import { listQuerySchema, acceptedResponseSchema } from "@civitasone/schemas/common";
import { leaveListResponseSchema, LeaveRequestDetailListSchema } from "@civitasone/schemas/web";
import {sendValidated, sendAccepted } from "@civitasone/schemas/validate";
import { resolveContext, requireRole, HttpError } from "../../shared/context.js";
import { createLeaveTypeBody, allocateLeaveBody, applyLeaveBody, idParam } from "./validators.js";
import * as commands from "./commands.js";
import * as queries from "./queries.js";

const HR_ROLES  = ["hr_admin", "hr_officer", "super_admin"];
const ALL_ROLES = [...HR_ROLES, "manager", "employee"];

export async function leaveRoutes(app: FastifyInstance): Promise<void> {
  app.post("/v1/hrms/leave-types", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, HR_ROLES);
    const body = createLeaveTypeBody.parse(req.body);
    return sendAccepted(reply, acceptedResponseSchema, await commands.createLeaveType(ctx, body));
  });

  app.post("/v1/hrms/leave-allocations", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, HR_ROLES);
    const body = allocateLeaveBody.parse(req.body);
    return sendAccepted(reply, acceptedResponseSchema, await commands.allocateLeave(ctx, body));
  });

  app.post("/v1/hrms/leave-applications", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, ALL_ROLES);
    const body = applyLeaveBody.parse(req.body);
    return sendAccepted(reply, acceptedResponseSchema, await commands.applyLeave(ctx, body));
  });

  app.patch("/v1/hrms/leave-applications/:id/approve", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, [...HR_ROLES, "manager"]);
    const { id } = idParam.parse(req.params);
    return sendAccepted(reply, acceptedResponseSchema, await commands.approveLeave(ctx, id));
  });

  app.get("/v1/hrms/leave-applications", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, ALL_ROLES);
    const q = listQuerySchema.extend({ empId: z.string().uuid().optional() }).parse(req.query);
    if (q.empId) {
      sendValidated(reply, leaveListResponseSchema, { data: await queries.getLeaveApplicationsByEmp(ctx.tenantId, q.empId) });
      return;
    }
    sendValidated(reply, leaveListResponseSchema, await queries.listLeaveApplications(ctx.tenantId, q.limit));
  });

  app.get("/v1/hrms/leave-requests", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, ALL_ROLES);
    const q = listQuerySchema.parse(req.query);
    sendValidated(reply, LeaveRequestDetailListSchema, await queries.listLeaveRequestDetails(ctx.tenantId, q.limit));
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
