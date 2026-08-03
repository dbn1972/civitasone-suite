import type { FastifyInstance } from "fastify";
import { ZodError, z } from "zod";
import { resolveContext, requireRole, HttpError } from "../../shared/context.js";
import * as matrixRepo from "./matrix-repo.js";
import { acceptedResponseSchema } from "@civitasone/schemas/common";
import { sendAccepted } from "@civitasone/schemas/validate";
import * as commands from "./commands.js";

const ADMIN_ROLES = ["workflow_admin", "super_admin", "tenant_admin"];

export async function assignmentRoutes(app: FastifyInstance): Promise<void> {
  // ─── Responsibility Matrix ──────────────────────────────────────────────────

  app.post("/v1/workflow/assignment/matrix", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, ADMIN_ROLES);
    const body = z.object({
      roleRef: z.string().min(1).max(128),
      conditionExpr: z.string().max(512).optional(),
      userId: z.string().uuid(),
      priority: z.number().int().min(0).default(1),
    }).parse(req.body);

    return sendAccepted(reply, acceptedResponseSchema, await commands.createMatrixRule(ctx, body));
  });

  app.get("/v1/workflow/assignment/matrix", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, ADMIN_ROLES);
    const q = z.object({
      roleRef: z.string().max(128).optional(),
      limit: z.coerce.number().int().min(1).max(200).default(50),
    }).parse(req.query);

    const rows = await matrixRepo.listMatrixRules(ctx.tenantId, q.roleRef, q.limit);
    return reply.send({ data: rows });
  });

  app.delete("/v1/workflow/assignment/matrix/:id", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, ADMIN_ROLES);
    const { id } = z.object({ id: z.string().uuid() }).parse(req.params);

    return sendAccepted(reply, acceptedResponseSchema, await commands.deactivateMatrixRule(ctx, id));
  });

  // ─── Substitution Rules ─────────────────────────────────────────────────────

  app.post("/v1/workflow/assignment/substitutions", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, ADMIN_ROLES);
    const body = z.object({
      userId: z.string().uuid(),
      substituteId: z.string().uuid(),
      fromDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
      toDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
      reason: z.string().max(256).optional(),
    }).parse(req.body);

    return sendAccepted(reply, acceptedResponseSchema, await commands.createSubstitution(ctx, body));
  });

  app.get("/v1/workflow/assignment/substitutions", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, ADMIN_ROLES);
    const q = z.object({
      limit: z.coerce.number().int().min(1).max(200).default(50),
    }).parse(req.query);

    const rows = await matrixRepo.listSubstitutions(ctx.tenantId, q.limit);
    return reply.send({ data: rows });
  });

  app.delete("/v1/workflow/assignment/substitutions/:id", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, ADMIN_ROLES);
    const { id } = z.object({ id: z.string().uuid() }).parse(req.params);

    return sendAccepted(reply, acceptedResponseSchema, await commands.deactivateSubstitution(ctx, id));
  });

  app.setErrorHandler((err, req, reply) => {
    const correlationId = (req.headers["x-correlation-id"] as string) ?? req.id;
    if (err instanceof ZodError) {
      return reply.code(400).send({ code: "VALIDATION_FAILED", message: "invalid request", correlationId, retryable: false });
    }
    if (err instanceof HttpError) {
      return reply.code(err.status).send({ code: err.code, message: err.message, correlationId, retryable: false });
    }
    req.log.error({ err }, "unhandled error");
    return reply.code(500).send({ code: "INTERNAL", message: "internal error", correlationId, retryable: true });
  });
}
