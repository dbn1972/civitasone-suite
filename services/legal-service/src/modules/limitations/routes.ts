import { sendAccepted } from "@civitasone/schemas/validate";
import { acceptedResponseSchema } from "@civitasone/schemas/common";
import type { FastifyInstance } from "fastify";
import { ZodError } from "zod";
import { resolveContext, requireRole, HttpError } from "../../shared/context.js";
import { createLimitationBody, updateLimitationBody, idParam, listLimitationsQuery } from "./validators.js";
import * as commands from "./commands.js";
import * as queries from "./queries.js";

const LEGAL_ROLES  = ["legal_officer", "legal_admin", "super_admin"];
const READER_ROLES = [...LEGAL_ROLES, "audit_officer"];

export async function limitationRoutes(app: FastifyInstance): Promise<void> {
  app.post("/v1/legal/limitations", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, LEGAL_ROLES);
    const body = createLimitationBody.parse(req.body);
    return sendAccepted(reply, acceptedResponseSchema, await commands.createLimitation(ctx, body));
  });

  app.get("/v1/legal/limitations", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, READER_ROLES);
    const q = listLimitationsQuery.parse(req.query);
    const { data, total } = await queries.listLimitations(ctx.tenantId, { matterId: q.matterId, status: q.status }, q.page, q.pageSize);
    return reply.send({ data, meta: { page: q.page, pageSize: q.pageSize, total } });
  });

  app.get("/v1/legal/limitations/:id", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, READER_ROLES);
    const { id } = idParam.parse(req.params);
    const rule = await queries.getLimitation(id, ctx.tenantId);
    if (!rule) throw new HttpError(404, "NOT_FOUND", "limitation rule not found");
    return reply.send({ data: rule });
  });

  app.patch("/v1/legal/limitations/:id", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, LEGAL_ROLES);
    const { id } = idParam.parse(req.params);
    const body = updateLimitationBody.parse(req.body);
    return sendAccepted(reply, acceptedResponseSchema, await commands.updateLimitation(ctx, id, body));
  });

  app.delete("/v1/legal/limitations/:id", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, LEGAL_ROLES);
    const { id } = idParam.parse(req.params);
    return sendAccepted(reply, acceptedResponseSchema, await commands.deleteLimitation(ctx, id));
  });

  app.setErrorHandler(errorHandler);
}

function errorHandler(err: unknown, req: any, reply: any): void {
  const correlationId = (req.headers["x-correlation-id"] as string) ?? req.id;
  if (err instanceof ZodError) {
    void reply.code(400).send({ code: "VALIDATION_FAILED", message: "invalid request", correlationId, retryable: false });
    return;
  }
  if (err instanceof HttpError) {
    void reply.code(err.status).send({ code: err.code, message: err.message, correlationId, retryable: false });
    return;
  }
  req.log.error({ err }, "unhandled error");
  void reply.code(500).send({ code: "INTERNAL", message: "internal error", correlationId, retryable: true });
}
