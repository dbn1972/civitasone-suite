import { sendAccepted, sendValidated } from "@civitasone/schemas/validate";
import { acceptedResponseSchema, listQuerySchema } from "@civitasone/schemas/common";
import { AuditPlanListSchema } from "@civitasone/schemas/web";
import type { FastifyInstance } from "fastify";
import { ZodError } from "zod";
import { resolveContext, requireRole, HttpError } from "../../shared/context.js";
import { createPlanBody, createPlanItemBody, deferPlanBody, idParam } from "./validators.js";
import * as commands from "./commands.js";
import * as queries from "./queries.js";
import * as repo from "./repo.js";
import { assertCanComplete, assertCanDefer, DomainError } from "./domain.js";

const AUDIT_ROLES = ["audit_officer", "audit_admin", "super_admin"];
const READER_ROLES = [...AUDIT_ROLES, "finance_admin"];

export async function planRoutes(app: FastifyInstance): Promise<void> {
  app.post("/v1/audit/plans", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, AUDIT_ROLES);
    const body = createPlanBody.parse(req.body);
    return sendAccepted(reply, acceptedResponseSchema, await commands.createPlan(ctx, body));
  });

  app.post("/v1/audit/plans/:id/items", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, AUDIT_ROLES);
    const { id } = idParam.parse(req.params);
    const body = createPlanItemBody.parse(req.body);
    return sendAccepted(reply, acceptedResponseSchema, await commands.createPlanItem(ctx, id, body));
  });

  app.patch("/v1/audit/plans/:id/start", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, AUDIT_ROLES);
    const { id } = idParam.parse(req.params);
    // UAT W8-C: tenant-scoped existence read (uncached) before publishing: an unknown plan is a 404, not a
    // 202 for a command that can never apply. The consumer stays the race-safe check.
    if (!(await repo.findPlanById(id, ctx.tenantId))) throw new HttpError(404, "NOT_FOUND", "plan not found");
    return sendAccepted(reply, acceptedResponseSchema, await commands.startPlan(ctx, id));
  });

  // GAP-AUDIT-PLAN-05: defer (reason required) and complete. Same 404 pre-check as /start, plus a 409
  // pre-check on the current status; the consumer remains the race-safe authority.
  app.patch("/v1/audit/plans/:id/defer", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, AUDIT_ROLES);
    const { id } = idParam.parse(req.params);
    const body = deferPlanBody.parse(req.body);
    const plan = await repo.findPlanById(id, ctx.tenantId);
    if (!plan) throw new HttpError(404, "NOT_FOUND", "plan not found");
    guard(() => assertCanDefer(plan.status ?? "draft"));
    return sendAccepted(reply, acceptedResponseSchema, await commands.deferPlan(ctx, id, body));
  });

  app.patch("/v1/audit/plans/:id/complete", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, AUDIT_ROLES);
    const { id } = idParam.parse(req.params);
    const plan = await repo.findPlanById(id, ctx.tenantId);
    if (!plan) throw new HttpError(404, "NOT_FOUND", "plan not found");
    guard(() => assertCanComplete(plan.status ?? "draft"));
    return sendAccepted(reply, acceptedResponseSchema, await commands.completePlan(ctx, id));
  });

  // LIST top-level audit plans (auditPlans) for the caller's tenant. Distinct
  // from GET /v1/audit/plan (singular, below) which lists the per-department
  // plan-ITEMS sub-resource — that route existed already; this one (the
  // plans themselves) was missing entirely, which surfaced as a 404 rather
  // than a genuine RLS-isolation failure in tests/rls-isolation.test.ts.
  app.get("/v1/audit/plans", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, READER_ROLES);
    const q = listQuerySchema.parse(req.query);
    const plans = await queries.listPlans(ctx.tenantId, q.limit);
    return reply.send({ data: plans });
  });

  app.get("/v1/audit/plans/:id", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, READER_ROLES);
    const { id } = idParam.parse(req.params);
    const plan = await queries.getPlan(id, ctx.tenantId);
    if (!plan) throw new HttpError(404, "NOT_FOUND", "plan not found");
    return reply.send(plan);
  });

  app.get("/v1/audit/plan", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, READER_ROLES);
    const q = listQuerySchema.parse(req.query);
    sendValidated(reply, AuditPlanListSchema, await queries.listPlanItems(ctx.tenantId, q.limit));
  });

  app.setErrorHandler(errorHandler);
}

function guard(fn: () => void): void {
  try { fn(); } catch (e) {
    if (e instanceof DomainError) throw new HttpError(409, e.code, e.message);
    throw e;
  }
}

function errorHandler(err: unknown, req: { headers: Record<string, unknown>; id: string; log: { error: (o: object, m: string) => void } }, reply: { code: (n: number) => { send: (o: object) => void } }): void {
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
