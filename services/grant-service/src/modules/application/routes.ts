import { sendAccepted } from "@civitasone/schemas/validate";
import { acceptedResponseSchema } from "@civitasone/schemas/common";
import type { FastifyInstance } from "fastify";
import { ZodError } from "zod";
import { resolveContext, requireRole, HttpError } from "../../shared/context.js";
import { submitApplicationBody, scoreApplicationBody, approveApplicationBody, rejectApplicationBody, idParam } from "./validators.js";
import * as commands from "./commands.js";
import * as queries from "./queries.js";

const GRANT_ROLES   = ["grant_officer", "grant_admin", "super_admin"];
const REVIEW_ROLES  = ["grant_reviewer", ...GRANT_ROLES];
const READER_ROLES  = [...REVIEW_ROLES, "audit_officer"];

export async function applicationRoutes(app: FastifyInstance): Promise<void> {
  app.post("/v1/grants/schemes/:id/applications", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, GRANT_ROLES);
    const { id: schemeId } = idParam.parse(req.params);
    const body = submitApplicationBody.parse(req.body);
    return sendAccepted(reply, acceptedResponseSchema, await commands.submitApplication(ctx, schemeId, body));
  });

  app.patch("/v1/grants/applications/:id/score", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, REVIEW_ROLES);
    const { id } = idParam.parse(req.params);
    const body = scoreApplicationBody.parse(req.body);
    return sendAccepted(reply, acceptedResponseSchema, await commands.scoreApplication(ctx, id, body));
  });

  app.patch("/v1/grants/applications/:id/approve", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, GRANT_ROLES);
    const { id } = idParam.parse(req.params);
    const body = approveApplicationBody.parse(req.body);
    return sendAccepted(reply, acceptedResponseSchema, await commands.approveApplication(ctx, id, body));
  });

  app.patch("/v1/grants/applications/:id/reject", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, GRANT_ROLES);
    const { id } = idParam.parse(req.params);
    const body = rejectApplicationBody.parse(req.body);
    return sendAccepted(reply, acceptedResponseSchema, await commands.rejectApplication(ctx, id, body));
  });

  app.get("/v1/grants/applications/:id", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, READER_ROLES);
    const { id } = idParam.parse(req.params);
    const app = await queries.getApplication(ctx.tenantId, id);
    if (!app) throw new HttpError(404, "NOT_FOUND", "application not found");
    return reply.send(app);
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
