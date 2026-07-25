import { sendAccepted } from "@civitasone/schemas/validate";
import { acceptedResponseSchema, listQuerySchema } from "@civitasone/schemas/common";
import type { FastifyInstance } from "fastify";
import { ZodError } from "zod";
import { resolveContext, requireRole, HttpError } from "../../shared/context.js";
import {
  createPlanBody, aggregateFromIndentsBody, submitPlanBody,
  approvePlanBody, rejectPlanBody, linkTenderBody, idParam,
} from "./validators.js";
import * as commands from "./commands.js";
import * as queries from "./queries.js";

const WRITE_ROLES  = ["procurement_officer", "procurement_admin", "super_admin"];
const APPROVE_ROLES = ["procurement_admin", "super_admin"];
const READER_ROLES = [...WRITE_ROLES, "audit_officer", "finance_officer"];

export async function planningRoutes(app: FastifyInstance): Promise<void> {
  app.post("/v1/procurement/plans", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, WRITE_ROLES);
    const body = createPlanBody.parse(req.body);
    return sendAccepted(reply, acceptedResponseSchema, await commands.createPlan(ctx, body));
  });

  app.post("/v1/procurement/plans/aggregate-from-indents", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, WRITE_ROLES);
    const body = aggregateFromIndentsBody.parse(req.body);
    return sendAccepted(reply, acceptedResponseSchema, await commands.aggregatePlanFromIndents(ctx, body));
  });

  app.patch("/v1/procurement/plans/:id/submit", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, WRITE_ROLES);
    const { id } = idParam.parse(req.params);
    const body = submitPlanBody.parse(req.body ?? {});
    return sendAccepted(reply, acceptedResponseSchema, await commands.submitPlan(ctx, id, body));
  });

  app.patch("/v1/procurement/plans/:id/approve", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, APPROVE_ROLES);
    const { id } = idParam.parse(req.params);
    const body = approvePlanBody.parse(req.body ?? {});
    return sendAccepted(reply, acceptedResponseSchema, await commands.approvePlan(ctx, id, body));
  });

  app.patch("/v1/procurement/plans/:id/reject", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, APPROVE_ROLES);
    const { id } = idParam.parse(req.params);
    const body = rejectPlanBody.parse(req.body);
    return sendAccepted(reply, acceptedResponseSchema, await commands.rejectPlan(ctx, id, body));
  });

  app.post("/v1/procurement/plans/:id/link-tender", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, WRITE_ROLES);
    const { id } = idParam.parse(req.params);
    const body = linkTenderBody.parse(req.body);
    return sendAccepted(reply, acceptedResponseSchema, await commands.linkTender(ctx, id, body));
  });

  app.get("/v1/procurement/plans", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, READER_ROLES);
    const q = listQuerySchema.parse(req.query);
    const list = await queries.listPlans(ctx.tenantId, q.limit, q.offset);
    return reply.send({ data: list });
  });

  app.get("/v1/procurement/plans/:id", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, READER_ROLES);
    const { id } = idParam.parse(req.params);
    const plan = await queries.getPlan(id, ctx.tenantId);
    if (!plan) throw new HttpError(404, "NOT_FOUND", "plan not found");
    return reply.send({ data: plan });
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
