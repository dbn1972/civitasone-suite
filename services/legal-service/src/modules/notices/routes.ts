import { sendAccepted } from "@civitasone/schemas/validate";
import { acceptedResponseSchema } from "@civitasone/schemas/common";
import type { FastifyInstance } from "fastify";
import { ZodError } from "zod";
import { resolveContext, requireRole, HttpError } from "../../shared/context.js";
import { createNoticeBody, respondNoticeBody, idParam } from "./validators.js";
import * as commands from "./commands.js";

const LEGAL_ROLES = ["legal_officer", "legal_admin", "super_admin"];

export async function noticeRoutes(app: FastifyInstance): Promise<void> {
  app.post("/v1/legal/notices", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, LEGAL_ROLES);
    const body = createNoticeBody.parse(req.body);
    return sendAccepted(reply, acceptedResponseSchema, await commands.createNotice(ctx, body));
  });

  app.post("/v1/legal/notices/:id/respond", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, LEGAL_ROLES);
    const { id } = idParam.parse(req.params);
    const body = respondNoticeBody.parse(req.body);
    return sendAccepted(reply, acceptedResponseSchema, await commands.respondNotice(ctx, id, body));
  });

  app.setErrorHandler((err, req, reply) => {
    const correlationId = (req.headers["x-correlation-id"] as string) ?? req.id;
    if (err instanceof ZodError) return reply.code(400).send({ code: "VALIDATION_FAILED", message: "invalid request", correlationId, retryable: false });
    if (err instanceof HttpError) return reply.code(err.status).send({ code: err.code, message: err.message, correlationId, retryable: false });
    req.log.error({ err }, "unhandled error");
    return reply.code(500).send({ code: "INTERNAL", message: "internal error", correlationId, retryable: true });
  });
}
