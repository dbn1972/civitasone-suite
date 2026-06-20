import { sendAccepted } from "@civitasone/schemas/validate";
import { acceptedResponseSchema } from "@civitasone/schemas/common";
import type { FastifyInstance } from "fastify";
import { ZodError } from "zod";
import { resolveContext, requireRole, HttpError } from "../../shared/context.js";
import { idParam, createCourtCaseBody, setNextDateBody, createRtiBody, respondRtiBody } from "./validators.js";
import * as commands from "./commands.js";

const ESTAB_ROLES  = ["estab_officer", "estab_admin", "super_admin"];

export async function legalRoutes(app: FastifyInstance): Promise<void> {
  app.post("/v1/estab/court-cases", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, ESTAB_ROLES);
    const body = createCourtCaseBody.parse(req.body);
    return sendAccepted(reply, acceptedResponseSchema, await commands.createCourtCase(ctx, body));
  });

  app.patch("/v1/estab/court-cases/:id/date", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, ESTAB_ROLES);
    const { id } = idParam.parse(req.params);
    const body = setNextDateBody.parse(req.body);
    return sendAccepted(reply, acceptedResponseSchema, await commands.setNextDate(ctx, id, body));
  });

  app.post("/v1/estab/rti", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, ESTAB_ROLES);
    const body = createRtiBody.parse(req.body);
    return sendAccepted(reply, acceptedResponseSchema, await commands.createRti(ctx, body));
  });

  app.patch("/v1/estab/rti/:id/respond", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, ESTAB_ROLES);
    const { id } = idParam.parse(req.params);
    const body = respondRtiBody.parse(req.body);
    return sendAccepted(reply, acceptedResponseSchema, await commands.respondRti(ctx, id, body));
  });

  app.setErrorHandler((err, req, reply) => {
    const correlationId = (req.headers["x-correlation-id"] as string) ?? req.id;
    if (err instanceof ZodError) {
      return reply.code(400).send({
        code: "VALIDATION_FAILED", message: "invalid request", correlationId, retryable: false,
        fieldErrors: err.issues.map((i) => ({ field: i.path.join("."), message: i.message })),
      });
    }
    if (err instanceof HttpError) {
      return reply.code(err.status).send({ code: err.code, message: err.message, correlationId, retryable: false });
    }
    req.log.error({ err }, "unhandled error");
    return reply.code(500).send({ code: "INTERNAL", message: "internal error", correlationId, retryable: true });
  });
}
