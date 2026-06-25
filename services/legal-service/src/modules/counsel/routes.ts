import { sendAccepted } from "@civitasone/schemas/validate";
import { acceptedResponseSchema } from "@civitasone/schemas/common";
import type { FastifyInstance } from "fastify";
import { ZodError } from "zod";
import { resolveContext, requireRole, HttpError } from "../../shared/context.js";
import { assignBriefBody, idParam, listBriefsQuery } from "./validators.js";
import * as commands from "./commands.js";
import * as queries from "./queries.js";

const LEGAL_ROLES  = ["legal_officer", "legal_admin", "super_admin"];
const READER_ROLES = [...LEGAL_ROLES, "audit_officer"];

export async function counselBriefRoutes(app: FastifyInstance): Promise<void> {
  app.post("/v1/legal/counsel-briefs", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, LEGAL_ROLES);
    const body = assignBriefBody.parse(req.body);
    return sendAccepted(reply, acceptedResponseSchema, await commands.assignBrief(ctx, body));
  });

  app.get("/v1/legal/counsel-briefs/:id", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, READER_ROLES);
    const { id } = idParam.parse(req.params);
    const brief = await queries.getBrief(id, ctx.tenantId);
    if (!brief) throw new HttpError(404, "NOT_FOUND", "counsel brief not found");
    return reply.send(brief);
  });

  app.get("/v1/legal/counsel-briefs", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, READER_ROLES);
    const q = listBriefsQuery.parse(req.query);
    return reply.send({ items: await queries.listBriefs(ctx.tenantId, q.caseId, q.status) });
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
