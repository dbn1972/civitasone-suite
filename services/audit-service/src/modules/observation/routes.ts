import { sendAccepted } from "@civitasone/schemas/validate";
import { acceptedResponseSchema } from "@civitasone/schemas/common";
import type { FastifyInstance } from "fastify";
import { ZodError } from "zod";
import { resolveContext, requireRole, HttpError } from "../../shared/context.js";
import { createObservationBody, draftParaBody, idParam } from "./validators.js";
import * as commands from "./commands.js";

const AUDIT_ROLES = ["audit_officer", "audit_admin", "super_admin"];

export async function observationRoutes(app: FastifyInstance): Promise<void> {
  app.post("/v1/audit/observations", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, AUDIT_ROLES);
    const body = createObservationBody.parse(req.body);
    return sendAccepted(reply, acceptedResponseSchema, await commands.createObservation(ctx, body));
  });

  app.post("/v1/audit/observations/:id/draft-para", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, AUDIT_ROLES);
    const { id } = idParam.parse(req.params);
    const body = draftParaBody.parse(req.body);
    return sendAccepted(reply, acceptedResponseSchema, await commands.draftPara(ctx, id, body));
  });

  app.setErrorHandler((err, req, reply) => {
    const correlationId = (req.headers["x-correlation-id"] as string) ?? req.id;
    if (err instanceof ZodError) return reply.code(400).send({ code: "VALIDATION_FAILED", message: "invalid request", correlationId, retryable: false });
    if (err instanceof HttpError) return reply.code(err.status).send({ code: err.code, message: err.message, correlationId, retryable: false });
    req.log.error({ err }, "unhandled error");
    return reply.code(500).send({ code: "INTERNAL", message: "internal error", correlationId, retryable: true });
  });
}
