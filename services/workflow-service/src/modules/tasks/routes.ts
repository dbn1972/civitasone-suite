import type { FastifyInstance } from "fastify";
import { ZodError, z } from "zod";
import { listQuerySchema, acceptedResponseSchema } from "@civitasone/schemas/common";
import { sendAccepted, sendValidated } from "@civitasone/schemas/validate";
import { resolveContext, requireRole, requirePermissionKey, HttpError } from "../../shared/context.js";
import { idParam, taskViewSchema, completeTaskBody } from "./validators.js";
import { paginatedSchema } from "@civitasone/schemas/common";
import * as commands from "./commands.js";
import * as queries from "./queries.js";

const tasksListSchema = paginatedSchema(taskViewSchema);

const ROLES = [
  "workflow_user", "workflow_admin", "super_admin", "hr_admin", "manager",
  "payroll_admin", "procurement_admin", "procurement_officer",
  "estab_officer", "estab_admin", "estab_section_officer", "estab_under_secretary", "estab_deputy_secretary",
];

export async function taskRoutes(app: FastifyInstance): Promise<void> {
  app.get("/v1/workflow/tasks", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, ROLES);
    const q = listQuerySchema.extend({ status: z.string().optional() }).parse(req.query);
    const listOpts: { status?: string; roles?: string[] } = {};
    if (q.status !== undefined) listOpts.status = q.status;
    if (ctx.roles.length) listOpts.roles = ctx.roles;
    sendValidated(reply, tasksListSchema, await queries.listTasks(ctx.tenantId, q.limit, q.offset, listOpts));
  });

  app.post("/v1/workflow/tasks/:id/complete", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, ROLES);
    const { id } = idParam.parse(req.params);
    const body = completeTaskBody.parse(req.body ?? {});
    const task = await queries.getTask(id, ctx.tenantId);
    if (task?.refType === "leave_app") {
      await requirePermissionKey(ctx, "hrms.leave.approve");
    } else if (task?.refType === "payroll_run") {
      await requirePermissionKey(ctx, "payroll.run.approve");
    } else if (task?.refType === "procurement_indent") {
      await requirePermissionKey(ctx, "procurement.indent.approve");
    } else if (task?.refType === "procurement_po") {
      await requirePermissionKey(ctx, "procurement.po.approve");
    }
    return sendAccepted(reply, acceptedResponseSchema, await commands.completeTask(ctx, id, body.decision));
  });

  app.setErrorHandler((err, req, reply) => {
    const correlationId = (req.headers["x-correlation-id"] as string) ?? req.id;
    if (err instanceof ZodError) {
      return reply.code(400).send({ code: "VALIDATION_FAILED", message: "invalid request", correlationId, retryable: false, fieldErrors: err.issues.map((i) => ({ field: i.path.join("."), message: i.message })) });
    }
    if (err instanceof HttpError) {
      return reply.code(err.status).send({ code: err.code, message: err.message, correlationId, retryable: false });
    }
    req.log.error({ err }, "unhandled error");
    return reply.code(500).send({ code: "INTERNAL", message: "internal error", correlationId, retryable: true });
  });
}
