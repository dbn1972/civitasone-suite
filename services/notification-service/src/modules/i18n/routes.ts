import { z } from "zod";
import { sendAccepted } from "@civitasone/schemas/validate";
import { acceptedResponseSchema } from "@civitasone/schemas/common";
import type { FastifyInstance } from "fastify";
import { ZodError } from "zod";
import { resolveContext, requireRole, HttpError } from "../../shared/context.js";
import { validateBcp47 } from "./domain.js";
import * as commands from "./commands.js";
import * as repo from "./repo.js";

const ADMIN = ["platform_admin", "super_admin", "tenant_admin", "notification_admin"];

const createVariantBody = z.object({
  templateId: z.string().uuid(),
  locale: z.string().min(2).max(35),
  subject: z.string().optional(),
  body: z.string().min(1),
});

const updateVariantBody = z.object({
  subject: z.string().optional(),
  body: z.string().min(1).optional(),
  status: z.enum(["current", "needs_review"]).optional(),
});

const templateIdParam = z.object({ templateId: z.string().uuid() });
const variantIdParam = z.object({ id: z.string().uuid() });

export async function i18nRoutes(app: FastifyInstance): Promise<void> {
  // Create a locale variant for a template
  app.post("/v1/templates/:templateId/locales", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, ADMIN);
    const { templateId } = templateIdParam.parse(req.params);
    const body = createVariantBody.parse(req.body);

    // Validate BCP 47 locale code
    if (!validateBcp47(body.locale)) {
      throw new HttpError(400, "INVALID_LOCALE", `Invalid BCP 47 locale: ${body.locale}`);
    }

    // Check for duplicate
    const existing = await repo.findVariant(ctx.tenantId, templateId, body.locale);
    if (existing) {
      throw new HttpError(409, "DUPLICATE_LOCALE", `Locale variant '${body.locale}' already exists for this template`);
    }

    return sendAccepted(reply, acceptedResponseSchema, await commands.createLocaleVariant(ctx, {
      templateId,
      locale: body.locale,
      subject: body.subject,
      body: body.body,
    }));
  });

  // List all locale variants for a template
  app.get("/v1/templates/:templateId/locales", async (req, reply) => {
    const ctx = resolveContext(req);
    const { templateId } = templateIdParam.parse(req.params);
    const variants = await repo.listVariants(ctx.tenantId, templateId);
    return reply.send({ data: variants, meta: { total: variants.length } });
  });

  // Update a locale variant
  app.patch("/v1/templates/:templateId/locales/:id", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, ADMIN);
    templateIdParam.parse(req.params);
    const { id } = variantIdParam.parse(req.params);
    const body = updateVariantBody.parse(req.body);
    return sendAccepted(reply, acceptedResponseSchema, await commands.updateLocaleVariant(ctx, id, body));
  });

  app.setErrorHandler((err, req, reply) => {
    const correlationId = (req.headers["x-correlation-id"] as string) ?? req.id;
    if (err instanceof ZodError) return reply.code(400).send({ code: "VALIDATION_FAILED", message: "invalid request", correlationId, retryable: false });
    if (err instanceof HttpError) return reply.code(err.status).send({ code: err.code, message: err.message, correlationId, retryable: false });
    req.log.error({ err }, "unhandled error");
    return reply.code(500).send({ code: "INTERNAL", message: "internal error", correlationId, retryable: true });
  });
}
