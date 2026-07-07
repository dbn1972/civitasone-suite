/**
 * templates HTTP routes — CRUD + execute for report templates.
 * POST /v1/reports/templates → 202
 * GET  /v1/reports/templates → list
 * GET  /v1/reports/templates/:id → single
 * PATCH /v1/reports/templates/:id → update (optimistic locking)
 * DELETE /v1/reports/templates/:id → soft-delete
 * POST /v1/reports/templates/:id/execute → 202 (trigger generation)
 */
import type { FastifyInstance } from "fastify";
import { ZodError } from "zod";
import { listQuerySchema } from "@civitasone/schemas/common";
import { resolveContext, requireRole, HttpError } from "../../shared/context.js";
import { createTemplateBody, updateTemplateBody, executeTemplateBody, idParam } from "./validators.js";
import * as commands from "./commands.js";
import * as queries from "./queries.js";

const ROLES = ["report_user", "report_admin", "super_admin", "tenant_admin"];

export async function templateRoutes(app: FastifyInstance): Promise<void> {
  // Create template → 202
  app.post("/v1/reports/templates", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, ROLES);
    const body = createTemplateBody.parse(req.body);
    const result = await commands.createTemplate(ctx, body);
    return reply.code(202).send({ data: result });
  });

  // List templates
  app.get("/v1/reports/templates", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, ROLES);
    const q = listQuerySchema.parse(req.query);
    const result = await queries.listTemplates(ctx.tenantId, q.limit, q.offset);
    return reply.send({ data: result.data, meta: { page: Math.floor(q.offset / q.limit) + 1, pageSize: q.limit, total: result.data.length } });
  });

  // Get single template
  app.get("/v1/reports/templates/:id", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, ROLES);
    const { id } = idParam.parse(req.params);
    const template = await queries.getTemplate(ctx.tenantId, id);
    if (!template || template.status === "archived") {
      throw new HttpError(404, "NOT_FOUND", "template not found");
    }
    return reply.send({ data: template });
  });

  // Update template (optimistic locking via version)
  app.patch("/v1/reports/templates/:id", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, ROLES);
    const { id } = idParam.parse(req.params);
    const body = updateTemplateBody.parse(req.body);
    const result = await commands.updateTemplate(ctx, id, body);
    return reply.code(202).send({ data: result });
  });

  // Soft-delete template
  app.delete("/v1/reports/templates/:id", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, ROLES);
    const { id } = idParam.parse(req.params);
    const result = await commands.deleteTemplate(ctx, id);
    return reply.code(202).send({ data: result });
  });

  // Execute template → 202 (trigger report generation with params)
  app.post("/v1/reports/templates/:id/execute", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, ROLES);
    const { id } = idParam.parse(req.params);
    const body = executeTemplateBody.parse(req.body);
    const result = await commands.executeTemplate(ctx, id, body);
    return reply.code(202).send({ data: result });
  });

  app.setErrorHandler((err, req, reply) => {
    const correlationId = (req.headers["x-correlation-id"] as string) ?? req.id;
    if (err instanceof ZodError || (typeof err === "object" && err !== null && (err as { name?: string }).name === "ZodError")) {
      return reply.code(400).send({
        code: "VALIDATION_FAILED",
        message: "invalid request",
        correlationId,
        retryable: false,
        fieldErrors: (err as ZodError).issues.map((i) => ({ field: i.path.join("."), message: i.message })),
      });
    }
    if (err instanceof HttpError) {
      return reply.code(err.status).send({ code: err.code, message: err.message, correlationId, retryable: false });
    }
    req.log.error({ err }, "unhandled error");
    return reply.code(500).send({ code: "INTERNAL", message: "internal error", correlationId, retryable: true });
  });
}
