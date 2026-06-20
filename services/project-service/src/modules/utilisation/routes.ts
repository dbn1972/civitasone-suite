import { sendAccepted } from "@civitasone/schemas/validate";
import { acceptedResponseSchema } from "@civitasone/schemas/common";
import type { FastifyInstance } from "fastify";
import { ZodError } from "zod";
import { resolveContext, requireRole, HttpError } from "../../shared/context.js";
import { submitUcBody, schemeIdParam } from "./validators.js";
import * as commands from "./commands.js";
import * as queries from "./queries.js";

const UC_ROLES     = ["project_manager", "finance_officer", "super_admin"];
const READER_ROLES = [...UC_ROLES, "audit_officer"];

export async function utilisationRoutes(app: FastifyInstance): Promise<void> {
  app.post("/v1/projects/schemes/:id/uc-statements", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, UC_ROLES);
    const { id } = schemeIdParam.parse(req.params);
    const body = submitUcBody.parse(req.body);
    return sendAccepted(reply, acceptedResponseSchema, await commands.submitUc(ctx, id, body));
  });

  app.get("/v1/projects/schemes/:id/uc-statements", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, READER_ROLES);
    const { id } = schemeIdParam.parse(req.params);
    return reply.send(await queries.getUcStatements(id, ctx.tenantId));
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
