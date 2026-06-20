import { sendAccepted } from "@civitasone/schemas/validate";
import { acceptedResponseSchema } from "@civitasone/schemas/common";
import type { FastifyInstance } from "fastify";
import { ZodError } from "zod";
import { resolveContext, requireRole, HttpError } from "../../shared/context.js";
import { createAdvanceBody, createDebitNoteBody } from "./validators.js";
import * as commands from "./commands.js";

const PROC_ROLES = ["procurement_officer", "procurement_admin", "super_admin", "finance_officer"];

export async function paymentsRoutes(app: FastifyInstance): Promise<void> {
  app.post("/v1/procurement/advances", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, PROC_ROLES);
    const body = createAdvanceBody.parse(req.body);
    return sendAccepted(reply, acceptedResponseSchema, await commands.createAdvance(ctx, body));
  });

  app.post("/v1/procurement/debit-notes", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, PROC_ROLES);
    const body = createDebitNoteBody.parse(req.body);
    return sendAccepted(reply, acceptedResponseSchema, await commands.createDebitNote(ctx, body));
  });

  app.setErrorHandler(errorHandler);
}

function errorHandler(err: unknown, req: any, reply: any): void {
  const correlationId = (req.headers["x-correlation-id"] as string) ?? req.id;
  if (err instanceof ZodError) {
    void reply.code(400).send({ code: "VALIDATION_FAILED", message: "invalid request", correlationId, retryable: false, fieldErrors: err.issues.map((i) => ({ field: i.path.join("."), message: i.message })) });
    return;
  }
  if (err instanceof HttpError) {
    void reply.code(err.status).send({ code: err.code, message: err.message, correlationId, retryable: false });
    return;
  }
  req.log.error({ err }, "unhandled error");
  void reply.code(500).send({ code: "INTERNAL", message: "internal error", correlationId, retryable: true });
}
