import type { FastifyInstance } from "fastify";
import { ZodError } from "zod";
import { listQuerySchema, acceptedResponseSchema } from "@civitasone/schemas/common";
import { sendValidated, sendAccepted } from "@civitasone/schemas/validate";
import { resolveContext, requireRole, HttpError } from "../../shared/context.js";
import { createTemplateBody, idParam, templatesListSchema } from "./validators.js";
import * as commands from "./commands.js";
import * as repo from "./repo.js";

const ROLES = ["theme_admin", "super_admin"];

export async function templatesRoutes(app: FastifyInstance): Promise<void> {
  app.post("/v1/themes/templates", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, ROLES);
    const body = createTemplateBody.parse(req.body);
    sendAccepted(reply, acceptedResponseSchema, await commands.createTemplate(ctx, body));
  });

  app.get("/v1/themes/templates", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, ROLES);
    const q = listQuerySchema.parse(req.query);
    const rows = await repo.listByTenant(ctx.tenantId, q.limit, q.offset);
    // templatesListSchema is paginatedSchema(...) — {data, pagination}, NOT a
    // bare array. repo.listByTenant() returns a bare array, so this endpoint
    // always 400'd with "Expected object, received array" before this fix
    // (sendValidated runs schema.parse() on the way out and throws on
    // mismatch). Matches the wrapping already done correctly in
    // tokens/queries.ts (this same service) and plugin-service's items/queries.ts.
    sendValidated(reply, templatesListSchema, {
      data: rows,
      pagination: { hasMore: rows.length === q.limit, pageSize: q.limit, ...(rows.length ? { cursor: String(q.offset + rows.length) } : {}) },
    });
  });

  app.get("/v1/themes/templates/:id", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, ROLES);
    const { id } = idParam.parse(req.params);
    const row = await repo.findById(id, ctx.tenantId);
    if (!row) throw new HttpError(404, "NOT_FOUND", "template not found");
    return reply.send(row);
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
