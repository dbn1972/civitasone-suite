import { sendAccepted } from "@civitasone/schemas/validate";
import { acceptedResponseSchema } from "@civitasone/schemas/common";
import type { FastifyInstance } from "fastify";
import { ZodError } from "zod";
import { resolveContext, requireRole, HttpError } from "../../shared/context.js";
import { seekOpinionBody, draftOpinionBody, issueOpinionBody, idParam, listOpinionsQuery } from "./validators.js";
import * as commands from "./commands.js";
import * as queries from "./queries.js";

const LEGAL_ROLES  = ["legal_officer", "legal_admin", "super_admin"];
const READER_ROLES = [...LEGAL_ROLES, "audit_officer"];

export async function opinionRoutes(app: FastifyInstance): Promise<void> {
  app.post("/v1/legal/opinions", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, LEGAL_ROLES);
    const body = seekOpinionBody.parse(req.body);
    return sendAccepted(reply, acceptedResponseSchema, await commands.seekOpinion(ctx, body));
  });

  app.patch("/v1/legal/opinions/:id/draft", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, LEGAL_ROLES);
    const { id } = idParam.parse(req.params);
    const body = draftOpinionBody.parse(req.body);
    return sendAccepted(reply, acceptedResponseSchema, await commands.draftOpinion(ctx, id, body));
  });

  app.patch("/v1/legal/opinions/:id/issue", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, LEGAL_ROLES);
    const { id } = idParam.parse(req.params);
    const body = issueOpinionBody.parse(req.body ?? {});
    return sendAccepted(reply, acceptedResponseSchema, await commands.issueOpinion(ctx, id, body));
  });

  app.get("/v1/legal/opinions/:id", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, READER_ROLES);
    const { id } = idParam.parse(req.params);
    const opinion = await queries.getOpinion(id, ctx.tenantId);
    if (!opinion) throw new HttpError(404, "NOT_FOUND", "opinion not found");
    return reply.send(opinion);
  });

  app.get("/v1/legal/opinions", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, READER_ROLES);
    const q = listOpinionsQuery.parse(req.query);
    return reply.send({ items: await queries.listOpinions(ctx.tenantId, q.status, q.caseId) });
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
