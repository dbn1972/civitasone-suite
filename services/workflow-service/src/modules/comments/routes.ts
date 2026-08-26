import type { FastifyInstance } from "fastify";
import { z, ZodError } from "zod";
import { sendAccepted } from "@civitasone/schemas/validate";
import { acceptedResponseSchema } from "@civitasone/schemas/common";
import { resolveContext, requireRole, HttpError } from "../../shared/context.js";
import * as repo from "./repo.js";
import * as commands from "./commands.js";
import { visibleTo, buildThreads, validateBody } from "./domain.js";

// Anyone who can complete a workflow task (tasks/routes.ts ROLES) must also be able to
// comment — PR #730 records the leave-approve/reject reason as a comment right after
// completion, so the approver (hr_admin/manager/etc.) needs write access here too, or the
// reason silently fails to save. This is a superset union, not a straight copy of tasks.ts's
// ROLES: it keeps the pre-existing tenant_admin/case_manager (generic workflow admins who
// were never part of the task-completion list but could already comment) and adds every
// task-completion role. Deliberately NOT switched to tasks.ts's requirePermissionKey/
// REF_PERMISSION gate — that keys off a specific per-refType *approve* permission and would
// wrongly block a plain participant (e.g. the leave applicant, who typically only holds the
// generic workflow_user role) from ever commenting on their own request; comment write access
// should track workflow participation, not entity-specific approval authority.
const USER = [
  "workflow_user", "workflow_admin", "super_admin", "tenant_admin", "case_manager",
  "hr_admin", "manager", "payroll_admin", "procurement_admin", "procurement_officer",
  "estab_officer", "estab_admin", "estab_section_officer", "estab_under_secretary", "estab_deputy_secretary",
];

export async function commentsRoutes(app: FastifyInstance): Promise<void> {
  app.post("/v1/workflow/comments", async (req, reply) => {
    const ctx = resolveContext(req); requireRole(ctx, USER);
    const body = z.object({
      entityType: z.string().min(1).max(48),
      entityId: z.string().uuid(),
      parentCommentId: z.string().uuid().optional(),
      body: z.string().min(1).max(8000),
      visibility: z.enum(["internal", "external"]).default("internal"),
    }).parse(req.body);
    const v = validateBody(body.body);
    if (!v.allowed) throw new HttpError(400, "INVALID", v.errors.join(", "));
    if (body.parentCommentId) {
      const parent = await repo.find(ctx.tenantId, body.parentCommentId);
      if (!parent || parent.entityType !== body.entityType || parent.entityId !== body.entityId || parent.deletedAt) {
        throw new HttpError(404, "PARENT_NOT_FOUND", "parent comment not found on this entity");
      }
    }
    return sendAccepted(reply, acceptedResponseSchema, await commands.addComment(ctx, body));
  });

  app.get("/v1/workflow/comments", async (req, reply) => {
    const ctx = resolveContext(req); requireRole(ctx, USER);
    const q = z.object({
      entityType: z.string().min(1), entityId: z.string().uuid(),
      viewer: z.enum(["internal", "external"]).default("internal"),
    }).parse(req.query);
    const rows = await repo.listForEntity(ctx.tenantId, q.entityType, q.entityId);
    const visible = visibleTo(rows, q.viewer);
    return reply.send({ data: buildThreads(visible), meta: { total: visible.length } });
  });

  app.patch("/v1/workflow/comments/:id", async (req, reply) => {
    const ctx = resolveContext(req); requireRole(ctx, USER);
    const { id } = z.object({ id: z.string().uuid() }).parse(req.params);
    const body = z.object({ body: z.string().min(1).max(8000) }).parse(req.body);
    const existing = await repo.find(ctx.tenantId, id);
    if (!existing || existing.authorId !== ctx.actorId || existing.deletedAt) {
      throw new HttpError(404, "NOT_FOUND", "comment not found or not yours");
    }
    return sendAccepted(reply, acceptedResponseSchema, await commands.editComment(ctx, id, body));
  });

  app.delete("/v1/workflow/comments/:id", async (req, reply) => {
    const ctx = resolveContext(req); requireRole(ctx, USER);
    const { id } = z.object({ id: z.string().uuid() }).parse(req.params);
    const existing = await repo.find(ctx.tenantId, id);
    if (!existing || existing.authorId !== ctx.actorId || existing.deletedAt) {
      throw new HttpError(404, "NOT_FOUND", "comment not found or not yours");
    }
    return sendAccepted(reply, acceptedResponseSchema, await commands.deleteComment(ctx, id));
  });

  app.setErrorHandler((err, req, reply) => {
    const cid = (req.headers["x-correlation-id"] as string) ?? req.id;
    if (err instanceof ZodError) return reply.code(400).send({ code: "VALIDATION_FAILED", message: "invalid request", correlationId: cid });
    if (err instanceof HttpError) return reply.code(err.status).send({ code: err.code, message: err.message, correlationId: cid });
    req.log.error({ err }, "unhandled"); return reply.code(500).send({ code: "INTERNAL", message: "internal error", correlationId: cid });
  });
}
