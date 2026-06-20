import { sendAccepted } from "@civitasone/schemas/validate";
import { acceptedResponseSchema } from "@civitasone/schemas/common";
import type { FastifyInstance } from "fastify";
import { ZodError } from "zod";
import { resolveContext, requireRole, HttpError } from "../../shared/context.js";
import { submitUcBody, complianceReportBody, idParam } from "./validators.js";
import * as commands from "./commands.js";
import * as queries from "./queries.js";

const GRANT_ROLES  = ["grant_officer", "grant_admin", "super_admin", "finance_officer"];
const READER_ROLES = [...GRANT_ROLES, "audit_officer"];

export async function utilisationRoutes(app: FastifyInstance): Promise<void> {
  app.post("/v1/grants/applications/:id/uc", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, GRANT_ROLES);
    const { id: applicationId } = idParam.parse(req.params);
    const body = submitUcBody.parse(req.body);
    return sendAccepted(reply, acceptedResponseSchema, await commands.submitUc(ctx, applicationId, body));
  });

  app.post("/v1/grants/applications/:id/compliance", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, GRANT_ROLES);
    const { id: applicationId } = idParam.parse(req.params);
    const body = complianceReportBody.parse(req.body);
    return sendAccepted(reply, acceptedResponseSchema, await commands.submitComplianceReport(ctx, applicationId, body));
  });

  app.get("/v1/grants/applications/:id/uc", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, READER_ROLES);
    const { id: applicationId } = idParam.parse(req.params);
    return reply.send({ data: await queries.getUcStatements(ctx.tenantId, applicationId) });
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
