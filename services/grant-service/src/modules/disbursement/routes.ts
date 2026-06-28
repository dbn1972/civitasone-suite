import { sendAccepted, sendValidated } from "@civitasone/schemas/validate";
import { acceptedResponseSchema } from "@civitasone/schemas/common";
import { GrantReleaseListSchema } from "@civitasone/schemas/web";
import { listQuerySchema } from "@civitasone/schemas/common";
import type { FastifyInstance } from "fastify";
import { ZodError } from "zod";
import { resolveContext, requireRole, HttpError } from "../../shared/context.js";
import { createInstallmentsBody, disburseBody, pfmsReconcileBody, idParam, appIdQuery } from "./validators.js";
import * as commands from "./commands.js";
import * as queries from "./queries.js";

const GRANT_ROLES  = ["grant_officer", "grant_admin", "super_admin", "finance_officer"];
const READER_ROLES = [...GRANT_ROLES, "audit_officer"];

export async function disbursementRoutes(app: FastifyInstance): Promise<void> {
  app.post("/v1/grants/applications/:id/installments", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, GRANT_ROLES);
    const { id: applicationId } = idParam.parse(req.params);
    const body = createInstallmentsBody.parse(req.body);
    return sendAccepted(reply, acceptedResponseSchema, await commands.createInstallments(ctx, applicationId, body));
  });

  app.post("/v1/grants/installments/:id/disburse", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, GRANT_ROLES);
    const { id: installmentId } = idParam.parse(req.params);
    const body = disburseBody.parse(req.body);
    return sendAccepted(reply, acceptedResponseSchema, await commands.inititateDisbursement(ctx, installmentId, body));
  });

  app.post("/v1/grants/pfms/reconcile", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, GRANT_ROLES);
    const body = pfmsReconcileBody.parse(req.body);
    return sendAccepted(reply, acceptedResponseSchema, await commands.reconcilePfms(ctx, body));
  });

  // Submit a disbursement to eOffice for administrative approval. The eFile is
  // raised via the eOffice integration; the decision returns on
  // grant.disbursement.file_decided and moves the disbursement to initiated/cancelled.
  app.post("/v1/grants/disbursements/:id/submit-approval", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, GRANT_ROLES);
    const { id } = idParam.parse(req.params);
    return sendAccepted(reply, acceptedResponseSchema, await commands.submitDisbursementForApproval(ctx, id));
  });

  app.get("/v1/grants/installments", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, READER_ROLES);
    const { appId } = appIdQuery.parse(req.query);
    if (appId) {
      const installments = await queries.getInstallmentsByApplication(ctx.tenantId, appId);
      return reply.send({ data: installments });
    }
    const installments = await queries.listAllInstallments(ctx.tenantId, 200);
    return reply.send({ data: installments ?? [] });
  });

  app.get("/v1/grants/releases", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, READER_ROLES);
    const q = listQuerySchema.parse(req.query);
    sendValidated(reply, GrantReleaseListSchema, await queries.listGrantReleases(ctx.tenantId, q.limit));
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
