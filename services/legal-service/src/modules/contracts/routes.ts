import { sendAccepted } from "@civitasone/schemas/validate";
import { acceptedResponseSchema } from "@civitasone/schemas/common";
import type { FastifyInstance } from "fastify";
import { ZodError } from "zod";
import { resolveContext, requireRole, HttpError } from "../../shared/context.js";
import { createReviewBody, clearReviewBody, idParam } from "./validators.js";
import * as commands from "./commands.js";
import * as repo from "./repo.js";

const LEGAL_ROLES = ["legal_officer", "legal_admin", "super_admin"];

const READER_ROLES = [...LEGAL_ROLES, "audit_officer"];

export async function contractRoutes(app: FastifyInstance): Promise<void> {
  app.get("/v1/legal/contract-reviews", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, READER_ROLES);
    return reply.send({ items: await repo.listReviews(ctx.tenantId) });
  });

  app.post("/v1/legal/contract-reviews", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, LEGAL_ROLES);
    const body = createReviewBody.parse(req.body);
    return sendAccepted(reply, acceptedResponseSchema, await commands.createReview(ctx, body));
  });

  app.patch("/v1/legal/contract-reviews/:id/clear", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, LEGAL_ROLES);
    const { id } = idParam.parse(req.params);
    const body = clearReviewBody.parse(req.body);
    return sendAccepted(reply, acceptedResponseSchema, await commands.clearReview(ctx, id, body));
  });

  app.setErrorHandler((err, req, reply) => {
    const correlationId = (req.headers["x-correlation-id"] as string) ?? req.id;
    if (err instanceof ZodError) return reply.code(400).send({ code: "VALIDATION_FAILED", message: "invalid request", correlationId, retryable: false });
    if (err instanceof HttpError) return reply.code(err.status).send({ code: err.code, message: err.message, correlationId, retryable: false });
    req.log.error({ err }, "unhandled error");
    return reply.code(500).send({ code: "INTERNAL", message: "internal error", correlationId, retryable: true });
  });
}
