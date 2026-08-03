import type { FastifyInstance } from "fastify";
import { z, ZodError } from "zod";
import { sendAccepted } from "@civitasone/schemas/validate";
import { acceptedResponseSchema } from "@civitasone/schemas/common";
import { resolveContext, requireRole, HttpError } from "../../shared/context.js";
import * as repo from "./repo.js";
import * as commands from "./commands.js";
import { normalizeFilter, type WorkbasketFilter } from "./domain.js";

const USER = ["workflow_user", "workflow_admin", "super_admin", "tenant_admin", "case_manager"];
const ADMIN = ["workflow_admin", "super_admin", "tenant_admin", "case_manager"];

export async function workbasketsRoutes(app: FastifyInstance): Promise<void> {
  app.get("/v1/workflow/workbaskets", async (req, reply) => {
    const ctx = resolveContext(req); requireRole(ctx, USER);
    const data = await repo.list(ctx.tenantId);
    return reply.send({ data, meta: { total: data.length } });
  });
  app.put("/v1/workflow/workbaskets/:code", async (req, reply) => {
    const ctx = resolveContext(req); requireRole(ctx, ADMIN);
    const { code } = z.object({ code: z.string().min(1).max(64) }).parse(req.params);
    const body = z.object({
      name: z.string().min(1).max(200), description: z.string().max(500).optional(),
      filter: z.record(z.unknown()).default({}), sortOrder: z.string().max(64).default("created_at"),
    }).parse(req.body);
    const norm = normalizeFilter(body.filter, body.sortOrder);
    if (norm.errors.length > 0) throw new HttpError(400, "INVALID_FILTER", norm.errors.join(", "));
    return sendAccepted(reply, acceptedResponseSchema, await commands.upsertWorkbasket(ctx, {
      code, name: body.name, ...(body.description !== undefined ? { description: body.description } : {}),
      filter: norm.filter, sortOrder: norm.sortOrder,
    }));
  });
  app.get("/v1/workflow/workbaskets/:code/tasks", async (req, reply) => {
    const ctx = resolveContext(req); requireRole(ctx, USER);
    const { code } = z.object({ code: z.string().min(1).max(64) }).parse(req.params);
    const q = z.object({ limit: z.coerce.number().int().min(1).max(500).default(100) }).parse(req.query);
    const wb = await repo.findByCode(ctx.tenantId, code);
    if (!wb) throw new HttpError(404, "NOT_FOUND", "workbasket not found");
    const data = await repo.resolveTasks(ctx.tenantId, wb.filter as WorkbasketFilter, wb.sortOrder, q.limit);
    return reply.send({ data, meta: { total: data.length, workbasket: code } });
  });
  app.setErrorHandler((err, req, reply) => {
    const cid = (req.headers["x-correlation-id"] as string) ?? req.id;
    if (err instanceof ZodError) return reply.code(400).send({ code: "VALIDATION_FAILED", message: "invalid request", correlationId: cid });
    if (err instanceof HttpError) return reply.code(err.status).send({ code: err.code, message: err.message, correlationId: cid });
    req.log.error({ err }, "unhandled"); return reply.code(500).send({ code: "INTERNAL", message: "internal error", correlationId: cid });
  });
}
