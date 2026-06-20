import { sendAccepted } from "@civitasone/schemas/validate";
import { acceptedResponseSchema } from "@civitasone/schemas/common";
import type { FastifyInstance } from "fastify";
import { ZodError } from "zod";
import { resolveContext, requireRole, HttpError } from "../../shared/context.js";
import {
  createSchemeBody, createComponentBody, createFundReleaseBody, disburseBody,
  schemeIdParam, releaseIdParam,
} from "./validators.js";
import * as commands from "./commands.js";
import * as queries from "./queries.js";

const SCHEME_ROLES = ["project_manager", "finance_officer", "super_admin"];
const READER_ROLES = [...SCHEME_ROLES, "audit_officer"];

export async function schemeRoutes(app: FastifyInstance): Promise<void> {
  app.post("/v1/projects/schemes", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, SCHEME_ROLES);
    const body = createSchemeBody.parse(req.body);
    return sendAccepted(reply, acceptedResponseSchema, await commands.createScheme(ctx, body));
  });

  app.get("/v1/projects/schemes/:id", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, READER_ROLES);
    const { id } = schemeIdParam.parse(req.params);
    const scheme = await queries.getScheme(id, ctx.tenantId);
    if (!scheme) throw new HttpError(404, "NOT_FOUND", "scheme not found");
    return reply.send(scheme);
  });

  app.post("/v1/projects/schemes/:id/components", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, SCHEME_ROLES);
    const { id } = schemeIdParam.parse(req.params);
    const body = createComponentBody.parse(req.body);
    return sendAccepted(reply, acceptedResponseSchema, await commands.createComponent(ctx, id, body));
  });

  app.post("/v1/projects/schemes/:id/fund-releases", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, SCHEME_ROLES);
    const { id } = schemeIdParam.parse(req.params);
    const body = createFundReleaseBody.parse(req.body);
    return sendAccepted(reply, acceptedResponseSchema, await commands.createFundRelease(ctx, id, body));
  });

  app.patch("/v1/projects/schemes/:id/fund-releases/:rId/disburse", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, SCHEME_ROLES);
    const { id, rId } = releaseIdParam.parse(req.params);
    const body = disburseBody.parse(req.body ?? {});
    return sendAccepted(reply, acceptedResponseSchema, await commands.disburseFundRelease(ctx, id, rId, body));
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
