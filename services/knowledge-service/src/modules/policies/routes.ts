import type { FastifyInstance } from "fastify";
import { ZodError } from "zod";
import { acceptedResponseSchema } from "@civitasone/schemas/common";
import { sendAccepted } from "@civitasone/schemas/validate";
import { hasAnyRole } from "@civitasone/auth";
import type { RequestContext } from "@civitasone/types";
import { resolveContext, requireRole, HttpError } from "../../shared/context.js";
import { LifecycleError } from "./domain.js";
import * as commands from "./commands.js";
import * as queries from "./queries.js";
import type { Viewer } from "./repo.js";
import {
  createPolicyBody,
  submitPolicyBody,
  publishPolicyBody,
  acknowledgePolicyBody,
  ackReportBody,
  listPolicyQuery,
  rejectPolicyBody,
} from "./validators.js";

const ROLES = ["knowledge_user", "knowledge_admin", "super_admin"];
const APPROVER_ROLES = ["knowledge_admin", "super_admin"];

/** Lifecycle visibility for the caller: approver roles see all states, others only published + their own. */
function viewerOf(ctx: RequestContext): Viewer {
  return { actorId: ctx.actorId, privileged: hasAnyRole(ctx, APPROVER_ROLES) };
}
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
    const data = await queries.listPolicies(ctx.tenantId, filters, q.limit, q.offset, viewerOf(ctx));
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
    const policy = await queries.getPolicy(ctx.tenantId, id, viewerOf(ctx));
    if (!policy) throw new HttpError(404, "NOT_FOUND", "policy not found");
    return reply.send(policy);
  });

  app.get("/v1/knowledge/policies/:id/acknowledgements", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, ROLES);
    const { id } = req.params as { id: string };
    const viewer = viewerOf(ctx);
    // A caller who cannot see the document cannot see who acknowledged it.
    if (!viewer.privileged && !(await queries.getPolicy(ctx.tenantId, id, viewer))) {
      throw new HttpError(404, "NOT_FOUND", "policy not found");
    }
    const employeeIds = await queries.acknowledgedEmployeeIds(ctx.tenantId, id);
    // Who acknowledged is personal data (DPDP): approver roles get the full
    // list; everyone else gets the total count plus only their own id, which
    // is all the UI needs to show "you have acknowledged".
    const visibleIds = viewer.privileged ? employeeIds : employeeIds.filter((e) => e === ctx.actorId);
    return reply.send({ policyId: id, acknowledgedCount: employeeIds.length, employeeIds: visibleIds });
  });

  app.post("/v1/knowledge/policies/:id/acknowledgements/report", async (req, reply) => {
    const ctx = resolveContext(req);
    // Who-has / who-hasn't over an arbitrary roster is an oversight report.
    requireRole(ctx, APPROVER_ROLES);
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

  app.post("/v1/knowledge/policies/:id/reject", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, APPROVER_ROLES);
    const { id } = req.params as { id: string };
    const body = rejectPolicyBody.parse(req.body ?? {});
    return sendAccepted(reply, acceptedResponseSchema, await run(() => commands.rejectPolicy(ctx, id, body)));
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
    // An acknowledgement binds to the caller's own identity; nobody may
    // acknowledge on behalf of another employee.
    if (body.employeeId && body.employeeId !== ctx.actorId) {
      throw new HttpError(403, "FORBIDDEN", "an acknowledgement can only be recorded for yourself");
    }
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
