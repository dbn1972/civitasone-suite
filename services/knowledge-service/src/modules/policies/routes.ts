import type { FastifyInstance } from "fastify";
import { ZodError } from "zod";
import { acceptedResponseSchema } from "@civitasone/schemas/common";
import { sendAccepted } from "@civitasone/schemas/validate";
import { resolveContext, requireRole, HttpError } from "../../shared/context.js";
import { LifecycleError } from "./domain.js";
import * as commands from "./commands.js";
import * as queries from "./queries.js";
import {
  createPolicyBody,
  submitPolicyBody,
  publishPolicyBody,
  acknowledgePolicyBody,
  ackReportBody,
  listPolicyQuery,
} from "./validators.js";

const ROLES = ["knowledge_user", "knowledge_admin", "super_admin"];
const APPROVER_ROLES = ["knowledge_admin", "super_admin"];

/** Map a domain LifecycleError to the correct HTTP status. */
function mapLifecycle(err: LifecycleError): HttpError {
  switch (err.code) {
    case "NOT_FOUND":
      return new HttpError(404, "NOT_FOUND", err.message);
    case "MAKER_CHECKER":
      return new HttpError(403, "MAKER_CHECKER", err.message);
    case "INVALID_TRANSITION":
      return new HttpError(409, "INVALID_TRANSITION", err.message);
    default:
      return new HttpError(409, "INVALID_STATE", err.message);
  }
}

async function run<T>(fn: () => Promise<T>): Promise<T> {
  try {
    return await fn();
  } catch (err) {
    if (err instanceof LifecycleError) throw mapLifecycle(err);
    throw err;
  }
}

export async function policyRoutes(app: FastifyInstance): Promise<void> {
  app.get("/v1/knowledge/policies", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, ROLES);
    const q = listPolicyQuery.parse(req.query);
    const filters: { status?: string; docType?: string } = {};
    if (q.status) filters.status = q.status;
    if (q.docType) filters.docType = q.docType;
    const data = await queries.listPolicies(ctx.tenantId, filters, q.limit, q.offset);
    return reply.send(data);
  });

  app.get("/v1/knowledge/policies/review-due", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, ROLES);
    const { asOf } = req.query as { asOf?: string };
    const data = await queries.reviewDuePolicies(ctx.tenantId, asOf);
    return reply.send(data);
  });

  app.get("/v1/knowledge/policies/:id", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, ROLES);
    const { id } = req.params as { id: string };
    const policy = await queries.getPolicy(ctx.tenantId, id);
    if (!policy) throw new HttpError(404, "NOT_FOUND", "policy not found");
    return reply.send(policy);
  });

  app.get("/v1/knowledge/policies/:id/acknowledgements", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, ROLES);
    const { id } = req.params as { id: string };
    const employeeIds = await queries.acknowledgedEmployeeIds(ctx.tenantId, id);
    return reply.send({ policyId: id, acknowledgedCount: employeeIds.length, employeeIds });
  });

  app.post("/v1/knowledge/policies/:id/acknowledgements/report", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, ROLES);
    const { id } = req.params as { id: string };
    const body = ackReportBody.parse(req.body);
    const report = await queries.acknowledgementReport(ctx.tenantId, id, body.expectedEmployeeIds);
    return reply.send({ policyId: id, ...report });
  });

  app.post("/v1/knowledge/policies", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, ROLES);
    const body = createPolicyBody.parse(req.body);
    return sendAccepted(reply, acceptedResponseSchema, await commands.createPolicy(ctx, body));
  });

  app.post("/v1/knowledge/policies/:id/submit", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, ROLES);
    const { id } = req.params as { id: string };
    const body = submitPolicyBody.parse(req.body ?? {});
    return sendAccepted(reply, acceptedResponseSchema, await run(() => commands.submitForReview(ctx, id, body)));
  });

  app.post("/v1/knowledge/policies/:id/approve", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, APPROVER_ROLES);
    const { id } = req.params as { id: string };
    return sendAccepted(reply, acceptedResponseSchema, await run(() => commands.approvePolicy(ctx, id)));
  });

  app.post("/v1/knowledge/policies/:id/publish", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, APPROVER_ROLES);
    const { id } = req.params as { id: string };
    const body = publishPolicyBody.parse(req.body ?? {});
    return sendAccepted(reply, acceptedResponseSchema, await run(() => commands.publishPolicy(ctx, id, body)));
  });

  app.post("/v1/knowledge/policies/:id/supersede", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, APPROVER_ROLES);
    const { id } = req.params as { id: string };
    return sendAccepted(reply, acceptedResponseSchema, await run(() => commands.supersedePolicy(ctx, id)));
  });

  app.post("/v1/knowledge/policies/:id/withdraw", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, APPROVER_ROLES);
    const { id } = req.params as { id: string };
    return sendAccepted(reply, acceptedResponseSchema, await run(() => commands.withdrawPolicy(ctx, id)));
  });

  app.post("/v1/knowledge/policies/:id/acknowledge", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, ROLES);
    const { id } = req.params as { id: string };
    const body = acknowledgePolicyBody.parse(req.body ?? {});
    return sendAccepted(reply, acceptedResponseSchema, await run(() => commands.acknowledgePolicy(ctx, id, body)));
  });

  app.setErrorHandler((err, req, reply) => {
    const correlationId = (req.headers["x-correlation-id"] as string) ?? req.id;
    if (err instanceof ZodError) {
      return reply.code(400).send({
        code: "VALIDATION_FAILED",
        message: "invalid request",
        correlationId,
        retryable: false,
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
