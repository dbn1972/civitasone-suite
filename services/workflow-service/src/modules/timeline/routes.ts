import type { FastifyInstance } from "fastify";
import { z, ZodError } from "zod";
import { resolveContext, requireRole, HttpError } from "../../shared/context.js";
import { gather } from "./repo.js";
import { mergeTimeline } from "./domain.js";

const USER = ["workflow_user", "workflow_admin", "super_admin", "tenant_admin", "case_manager"];

export async function timelineRoutes(app: FastifyInstance): Promise<void> {
  // CAP-037 — merged chronological activity log for any (entityType, entityId).
  app.get("/v1/workflow/timeline", async (req, reply) => {
    const ctx = resolveContext(req); requireRole(ctx, USER);
    const q = z.object({
      entityType: z.string().min(1).max(48),
      entityId: z.string().uuid(),
      limit: z.coerce.number().int().min(1).max(500).default(100),
    }).parse(req.query);
    const entries = await gather(ctx.tenantId, q.entityType, q.entityId, q.limit);
    const merged = mergeTimeline(entries).slice(0, q.limit);
    return reply.send({ data: merged, meta: { total: merged.length, entityType: q.entityType, entityId: q.entityId } });
  });

  app.setErrorHandler((err, req, reply) => {
    const cid = (req.headers["x-correlation-id"] as string) ?? req.id;
    if (err instanceof ZodError) return reply.code(400).send({ code: "VALIDATION_FAILED", message: "invalid request", correlationId: cid });
    if (err instanceof HttpError) return reply.code(err.status).send({ code: err.code, message: err.message, correlationId: cid });
    req.log.error({ err }, "unhandled"); return reply.code(500).send({ code: "INTERNAL", message: "internal error", correlationId: cid });
  });
}
