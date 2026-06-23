import { sendAccepted } from "@civitasone/schemas/validate";
import { acceptedResponseSchema } from "@civitasone/schemas/common";
import type { FastifyInstance } from "fastify";
import { ZodError } from "zod";
import { resolveContext, requireRole, HttpError } from "../../shared/context.js";
import { createExportBody } from "./validators.js";
import * as commands from "./commands.js";

const EXPORT_ROLES = ["audit_officer", "audit_admin", "super_admin", "platform_admin"];

export async function exportRoutes(app: FastifyInstance): Promise<void> {
  app.post("/audit/exports", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, EXPORT_ROLES);
    const body = createExportBody.parse(req.body);
    return sendAccepted(reply, acceptedResponseSchema, await commands.requestExport(ctx, body));
  });

  app.setErrorHandler((err, req, reply) => {
    const correlationId = (req.headers["x-correlation-id"] as string) ?? req.id;
    if (err instanceof ZodError) return reply.code(400).send({ code: "VALIDATION_FAILED", message: "invalid request", correlationId, retryable: false });
    if (err instanceof HttpError) return reply.code(err.status).send({ code: err.code, message: err.message, correlationId, retryable: false });
    req.log.error({ err }, "unhandled error");
    return reply.code(500).send({ code: "INTERNAL", message: "internal error", correlationId, retryable: true });
  });
}
