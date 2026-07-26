import type { FastifyInstance } from "fastify";
import { z, ZodError } from "zod";
import { resolveContext, requireRole, HttpError } from "../../shared/context.js";
import * as repo from "./repo.js";
import { visibleTo, buildThreads, validateBody } from "./domain.js";

const USER = ["workflow_user", "workflow_admin", "super_admin", "tenant_admin", "case_manager"];

export async function commentsRoutes(app: FastifyInstance): Promise<void> {
  // CAP-038 — add a comment/note (optionally a reply) to any entity.
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
    try {
      const row = await repo.add({
        tenantId: ctx.tenantId, entityType: body.entityType, entityId: body.entityId,
        parentCommentId: body.parentCommentId, body: body.body, visibility: body.visibility, actorId: ctx.actorId,
      });
      return reply.code(201).send({ data: row });
    } catch (e) {
      if (e instanceof Error && e.message === "PARENT_NOT_FOUND") throw new HttpError(404, "PARENT_NOT_FOUND", "parent comment not found on this entity");
      throw e;
    }
  });

  // CAP-038 — list comments for an entity, threaded, visibility-filtered.
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

  // CAP-038 — edit your own comment.
  app.patch("/v1/workflow/comments/:id", async (req, reply) => {
    const ctx = resolveContext(req); requireRole(ctx, USER);
    const { id } = z.object({ id: z.string().uuid() }).parse(req.params);
    const body = z.object({ body: z.string().min(1).max(8000) }).parse(req.body);
    const updated = await repo.edit(ctx.tenantId, id, body.body, ctx.actorId);
    if (!updated) throw new HttpError(404, "NOT_FOUND", "comment not found or not yours");
    return reply.send({ data: updated });
  });

  // CAP-038 — soft-delete your own comment (history preserved).
  app.delete("/v1/workflow/comments/:id", async (req, reply) => {
    const ctx = resolveContext(req); requireRole(ctx, USER);
    const { id } = z.object({ id: z.string().uuid() }).parse(req.params);
    const ok = await repo.softDelete(ctx.tenantId, id, ctx.actorId);
    if (!ok) throw new HttpError(404, "NOT_FOUND", "comment not found or not yours");
    return reply.send({ data: { id, deleted: true } });
  });

  app.setErrorHandler((err, req, reply) => {
    const cid = (req.headers["x-correlation-id"] as string) ?? req.id;
    if (err instanceof ZodError) return reply.code(400).send({ code: "VALIDATION_FAILED", message: "invalid request", correlationId: cid });
    if (err instanceof HttpError) return reply.code(err.status).send({ code: err.code, message: err.message, correlationId: cid });
    req.log.error({ err }, "unhandled"); return reply.code(500).send({ code: "INTERNAL", message: "internal error", correlationId: cid });
  });
}
