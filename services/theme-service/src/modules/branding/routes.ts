import type { FastifyInstance } from "fastify";
import { ZodError } from "zod";
import { listQuerySchema, acceptedResponseSchema } from "@civitasone/schemas/common";
import { sendValidated, sendAccepted } from "@civitasone/schemas/validate";
import { resolveContext, requireRole, HttpError } from "../../shared/context.js";
import { upsertBrandingBody, idParam, brandingListSchema, brandingViewSchema } from "./validators.js";
import * as commands from "./commands.js";
import * as repo from "./repo.js";

const ROLES = ["theme_admin", "super_admin"];

export async function brandingRoutes(app: FastifyInstance): Promise<void> {
  app.put("/v1/themes/branding", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, ROLES);
    const body = upsertBrandingBody.parse(req.body);
    sendAccepted(reply, acceptedResponseSchema, await commands.upsertBranding(ctx, body));
  });

  app.get("/v1/themes/branding", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, ROLES);
    const branding = await repo.findByTenant(ctx.tenantId);
    if (!branding) throw new HttpError(404, "NOT_FOUND", "branding not configured");
    return reply.send(branding);
  });

  app.get("/v1/themes/branding/:id", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, ROLES);
    const { id } = idParam.parse(req.params);
    const row = await repo.findById(id, ctx.tenantId);
    if (!row) throw new HttpError(404, "NOT_FOUND", "branding not found");
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
