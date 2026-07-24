import { z } from "zod";
import { sendAccepted } from "@civitasone/schemas/validate";
import { acceptedResponseSchema } from "@civitasone/schemas/common";
import type { FastifyInstance } from "fastify";
import { ZodError } from "zod";
import { resolveContext, requireRole, HttpError } from "../../shared/context.js";
import * as commands from "./commands.js";
import * as repo from "./repo.js";

const ADMIN = ["platform_admin", "super_admin", "tenant_admin", "notification_admin"];

const createRuleBody = z.object({
  eventType: z.string().min(1).max(128),
  channel: z.string().min(1).max(32),
  accumulationWindowMinutes: z.number().int().min(5).max(1440),
  maxBatchSize: z.number().int().min(1).max(500).optional(),
  digestTemplateId: z.string().uuid(),
});

const updateRuleBody = z.object({
  accumulationWindowMinutes: z.number().int().min(5).max(1440).optional(),
  maxBatchSize: z.number().int().min(1).max(500).optional(),
  digestTemplateId: z.string().uuid().optional(),
  enabled: z.boolean().optional(),
});

const ruleIdParam = z.object({ id: z.string().uuid() });

export async function digestRoutes(app: FastifyInstance): Promise<void> {
  // Create a digest rule
  app.post("/v1/digest-rules", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, ADMIN);
    const body = createRuleBody.parse(req.body);
    return sendAccepted(reply, acceptedResponseSchema, await commands.createDigestRule(ctx, body));
  });

  // List digest rules
  app.get("/v1/digest-rules", async (req, reply) => {
    const ctx = resolveContext(req);
    const rules = await repo.listRules(ctx.tenantId);
    return reply.send({ data: rules, meta: { total: rules.length } });
  });

  // Update a digest rule
  app.patch("/v1/digest-rules/:id", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, ADMIN);
    const { id } = ruleIdParam.parse(req.params);
    const body = updateRuleBody.parse(req.body);
    return sendAccepted(reply, acceptedResponseSchema, await commands.updateDigestRule(ctx, id, body));
  });

  // Delete (disable) a digest rule
  app.delete("/v1/digest-rules/:id", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, ADMIN);
    const { id } = ruleIdParam.parse(req.params);
    return sendAccepted(reply, acceptedResponseSchema, await commands.updateDigestRule(ctx, id, { enabled: false }));
  });

  app.setErrorHandler((err, req, reply) => {
    const correlationId = (req.headers["x-correlation-id"] as string) ?? req.id;
    if (err instanceof ZodError) return reply.code(400).send({ code: "VALIDATION_FAILED", message: "invalid request", correlationId, retryable: false });
    if (err instanceof HttpError) return reply.code(err.status).send({ code: err.code, message: err.message, correlationId, retryable: false });
    req.log.error({ err }, "unhandled error");
    return reply.code(500).send({ code: "INTERNAL", message: "internal error", correlationId, retryable: true });
  });
}
