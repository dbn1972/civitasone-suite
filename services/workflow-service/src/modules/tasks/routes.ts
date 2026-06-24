import type { FastifyInstance } from "fastify";
import { ZodError, z } from "zod";
import { listQuerySchema, acceptedResponseSchema } from "@civitasone/schemas/common";
import { sendAccepted, sendValidated } from "@civitasone/schemas/validate";
import type { RequestContext } from "@civitasone/types";
import { resolveContext, requireRole, requirePermissionKey, HttpError } from "../../shared/context.js";
import { idParam, taskViewSchema, completeTaskBody, assignTaskBody, bulkCompleteBody } from "./validators.js";
import { paginatedSchema } from "@civitasone/schemas/common";
import * as commands from "./commands.js";
import * as queries from "./queries.js";

const tasksListSchema = paginatedSchema(taskViewSchema);

const ROLES = [
  "workflow_user", "workflow_admin", "super_admin", "hr_admin", "manager",
  "payroll_admin", "procurement_admin", "procurement_officer",
  "estab_officer", "estab_admin", "estab_section_officer", "estab_under_secretary", "estab_deputy_secretary",
];

const ASSIGN_ROLES = ["workflow_admin", "super_admin", "tenant_admin"];

// Per-refType domain permission gate, shared by single + bulk completion so a
// bulk-complete cannot bypass the per-task approve permission.
const REF_PERMISSION: Record<string, string> = {
  leave_app: "hrms.leave.approve",
  payroll_run: "payroll.run.approve",
  procurement_indent: "procurement.indent.approve",
  procurement_po: "procurement.po.approve",
};

async function requireTaskPermission(ctx: RequestContext, refType: string | null | undefined): Promise<void> {
  const key = refType ? REF_PERMISSION[refType] : undefined;
  if (key) await requirePermissionKey(ctx, key);
}

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
    await requireTaskPermission(ctx, task?.refType);
    return sendAccepted(reply, acceptedResponseSchema, await commands.completeTask(ctx, id, body.decision));
  });

  // P1-1 — claim an unassigned task (any role-holder who can see it). Synchronous.
  app.post("/v1/workflow/tasks/:id/claim", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, ROLES);
    const { id } = idParam.parse(req.params);
    const claimed = await commands.claimTask(ctx, id);
    return sendValidated(reply, taskViewSchema, claimed);
  });

  // P1-1 — assign a task to a specific user (admin only). Synchronous.
  app.post("/v1/workflow/tasks/:id/assign", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, ASSIGN_ROLES);
    const { id } = idParam.parse(req.params);
    const body = assignTaskBody.parse(req.body ?? {});
    const assigned = await commands.assignTask(ctx, id, body.assigneeId, body.reassign ?? false);
    return sendValidated(reply, taskViewSchema, assigned);
  });

  // P1-3 — bulk-complete. Per-task domain permission gate + the per-task
  // completeTask command (role-on-task + SoD + assignee + instance-active).
  app.post("/v1/workflow/tasks/bulk-complete", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, ROLES);
    const body = bulkCompleteBody.parse(req.body ?? {});
    const results: commands.BulkResult[] = [];
    const toRun: string[] = [];
    // Pre-gate the per-task domain permission; a permission failure for one task
    // is reported per-id without aborting the batch.
    for (const id of body.taskIds) {
      try {
        const task = await queries.getTask(id, ctx.tenantId);
        await requireTaskPermission(ctx, task?.refType);
        toRun.push(id);
      } catch (err) {
        if (err instanceof HttpError) results.push({ id, ok: false, code: err.code, message: err.message });
        else results.push({ id, ok: false, code: "INTERNAL", message: "internal error" });
      }
    }
    const completed = await commands.bulkComplete(ctx, toRun, body.decision);
    // preserve input order in the response
    const byId = new Map([...results, ...completed].map((r) => [r.id, r]));
    return reply.send({ data: body.taskIds.map((id) => byId.get(id)) });
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
