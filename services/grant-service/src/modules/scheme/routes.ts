import type { FastifyInstance } from "fastify";
import { ZodError } from "zod";
import { sendAccepted } from "@civitasone/schemas/validate";
import { listQuerySchema, acceptedResponseSchema } from "@civitasone/schemas/common";
import { resolveContext, requireRole, HttpError } from "../../shared/context.js";
import { createSchemeBody, createCriterionBody, idParam } from "./validators.js";
import * as commands from "./commands.js";
import * as queries from "./queries.js";

const SCHEME_ROLES  = ["grant_officer", "grant_admin", "super_admin"];
const READER_ROLES  = [...SCHEME_ROLES, "audit_officer", "finance_officer"];

export async function schemeRoutes(app: FastifyInstance): Promise<void> {
  app.post("/v1/grants/schemes", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, SCHEME_ROLES);
    const body = createSchemeBody.parse(req.body);
    return sendAccepted(reply, acceptedResponseSchema, await commands.createScheme(ctx, body));
  });

  app.post("/v1/grants/schemes/:id/criteria", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, SCHEME_ROLES);
    const { id } = idParam.parse(req.params);
    const body = createCriterionBody.parse(req.body);
    return sendAccepted(reply, acceptedResponseSchema, await commands.createCriterion(ctx, id, body));
  });

  app.get("/v1/grants/schemes", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, READER_ROLES);
    const q = listQuerySchema.parse(req.query);
    const schemes = await queries.listSchemes(ctx.tenantId, q.limit);
    return reply.send({ data: schemes, pagination: { hasMore: schemes.length === q.limit, pageSize: q.limit } });
  });

  app.get("/v1/grants/schemes/:id", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, READER_ROLES);
    const { id } = idParam.parse(req.params);
    const scheme = await queries.getScheme(ctx.tenantId, id);
    if (!scheme) throw new HttpError(404, "NOT_FOUND", "scheme not found");
    return reply.send(scheme);
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
