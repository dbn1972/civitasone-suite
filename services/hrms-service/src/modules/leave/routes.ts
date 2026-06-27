import type { FastifyInstance } from "fastify";
import { ZodError, z } from "zod";
import { listQuerySchema, acceptedResponseSchema } from "@civitasone/schemas/common";
import { leaveListResponseSchema, LeaveRequestDetailListSchema } from "@civitasone/schemas/web";
import {sendValidated, sendAccepted } from "@civitasone/schemas/validate";
import { eq } from "drizzle-orm";
import { resolveContext, requireRole, requirePermissionKey, HttpError } from "../../shared/context.js";
import { db } from "../../shared/db.js";
import { hrmsEmployees } from "../employee/schema.js";
import { createLeaveTypeBody, allocateLeaveBody, applyLeaveBody, idParam, rejectLeaveBody } from "./validators.js";
import { validateLeaveRequest, LEAVE_POLICIES, type EmployeeType, type LeaveCategory } from "./rules-engine.js";
import * as repo from "./repo.js";
import * as commands from "./commands.js";
import * as queries from "./queries.js";

const HR_ROLES  = ["hr_admin", "hr_officer", "super_admin"];
const ALL_ROLES = [...HR_ROLES, "manager", "employee"];


/**
 * Enforce CCS(Leave) Rules synchronously before accepting a leave application.
 * Activates the rules engine for codes it knows (CL/EL/HPL/ML/PL/CCL/...);
 * codes outside the engine (e.g. EOL/MED) fall back to the consumer balance
 * check so nothing breaks. Throws 422 on a rule violation.
 */
async function enforceCcsLeaveRules(tenantId: string, body: ReturnType<typeof applyLeaveBody.parse>): Promise<void> {
  const alloc = await repo.findAllocById(body.allocId);
  if (!alloc) throw new HttpError(404, "ALLOC_NOT_FOUND", "leave allocation not found");
  const types = await repo.listLeaveTypesByTenant(tenantId);
  const lt = types.find((t) => t.id === body.leaveTypeId);
  if (!lt) throw new HttpError(404, "LEAVE_TYPE_NOT_FOUND", "leave type not found");
  const code = (lt.code ?? "").toUpperCase();
  if (!LEAVE_POLICIES.some((pol) => pol.code === code)) return;
  const [emp] = await db.select().from(hrmsEmployees).where(eq(hrmsEmployees.id, body.employeeId));
  if (!emp) throw new HttpError(404, "EMP_NOT_FOUND", "employee not found");
  const allowed: EmployeeType[] = ["permanent", "temporary", "contract", "deputation"];
  const empType = (allowed as string[]).includes(emp.employeeType ?? "")
    ? (emp.employeeType as EmployeeType) : "permanent";
  const result = await validateLeaveRequest({
    employeeType: empType,
    leaveCode: code as LeaveCategory,
    fromDate: body.fromDate,
    toDate: body.toDate,
    daysApplied: body.daysApplied,
    currentBalance: alloc.balanceDays,
    totalAccumulated: alloc.totalDays,
    serviceStartDate: (emp.dateOfJoining as unknown as string) ?? body.fromDate,
    tenantId,
    isOnProbation: (emp.status ?? "") === "probation",
  });
  if (!result.valid) throw new HttpError(422, "LEAVE_RULE_VIOLATION", result.errors.join("; "));
}

export async function leaveRoutes(app: FastifyInstance): Promise<void> {
  app.post("/v1/hrms/leave-types", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, HR_ROLES);
    const body = createLeaveTypeBody.parse(req.body);
    return sendAccepted(reply, acceptedResponseSchema, await commands.createLeaveType(ctx, body));
  });

  app.get("/v1/hrms/leave-allocations", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, ALL_ROLES);
    const allocs = await queries.listLeaveAllocations(ctx.tenantId, 50);
    return reply.send({ data: allocs });
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
    await enforceCcsLeaveRules(ctx.tenantId, body);
    return sendAccepted(reply, acceptedResponseSchema, await commands.applyLeave(ctx, body));
  });

  app.post("/v1/hrms/leave-requests", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, ALL_ROLES);
    const body = applyLeaveBody.parse(req.body);
    await enforceCcsLeaveRules(ctx.tenantId, body);
    return sendAccepted(reply, acceptedResponseSchema, await commands.applyLeave(ctx, body));
  });

  app.patch("/v1/hrms/leave-applications/:id/approve", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, [...HR_ROLES, "manager"]);
    // Managers without HR/super_admin roles must go through the workflow queue
    if (!ctx.roles.some((r: string) => HR_ROLES.includes(r))) {
      throw new HttpError(403, "WORKFLOW_REQUIRED", "Direct approval requires HR admin privileges. Use the workflow queue.");
    }
    await requirePermissionKey(ctx, "hrms.leave.approve");
    const { id } = idParam.parse(req.params);
    return sendAccepted(reply, acceptedResponseSchema, await commands.approveLeave(ctx, id));
  });

  app.patch("/v1/hrms/leave-applications/:id/reject", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, [...HR_ROLES, "manager"]);
    await requirePermissionKey(ctx, "hrms.leave.approve");
    const { id } = idParam.parse(req.params);
    const body = rejectLeaveBody.parse(req.body);
    return sendAccepted(reply, acceptedResponseSchema, await commands.rejectLeave(ctx, id, body.reason));
  });

  // ── Aliases: some clients use leave-requests, others leave-applications ──
  app.patch("/v1/hrms/leave-requests/:id/approve", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, [...HR_ROLES, "manager"]);
    await requirePermissionKey(ctx, "hrms.leave.approve");
    const { id } = idParam.parse(req.params);
    return sendAccepted(reply, acceptedResponseSchema, await commands.approveLeave(ctx, id));
  });

  app.patch("/v1/hrms/leave-requests/:id/reject", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, [...HR_ROLES, "manager"]);
    await requirePermissionKey(ctx, "hrms.leave.approve");
    const { id } = idParam.parse(req.params);
    const body = rejectLeaveBody.parse(req.body);
    return sendAccepted(reply, acceptedResponseSchema, await commands.rejectLeave(ctx, id, body.reason));
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
  // Fastify client errors (e.g. malformed/empty JSON body) carry a 4xx
  // statusCode — surface them as client errors, not masked 500s.
  const sc = (err as { statusCode?: number })?.statusCode;
  if (typeof sc === "number" && sc >= 400 && sc < 500) {
    const code = (err as { code?: string })?.code ?? "BAD_REQUEST";
    void reply.code(sc).send({ code, message: (err as Error)?.message ?? "bad request", correlationId, retryable: false });
    return;
  }
  req.log.error({ err }, "unhandled error");
  void reply.code(500).send({ code: "INTERNAL", message: "internal error", correlationId, retryable: true });
}
