import type { FastifyInstance } from "fastify";
import { ZodError } from "zod";
import { resolveContext, requireRole, HttpError } from "../../shared/context.js";
import { idParam, createRuleSetBody, evaluateBody, reviewDecisionBody } from "./validators.js";
import * as commands from "./commands.js";
import * as queries from "./queries.js";

const OFFICER_ROLES = ["citizen_officer", "citizen_admin", "super_admin"];
const ADMIN_ROLES   = ["citizen_admin", "super_admin"];

export async function eligibilityRoutes(app: FastifyInstance): Promise<void> {
  // --- Rule set authoring / maker-checker publish -----------------------------
  app.post("/v1/citizen/eligibility/rule-sets", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, ADMIN_ROLES);
    const body = createRuleSetBody.parse(req.body);
    return reply.code(201).send(await commands.createRuleSet(ctx, body));
  });

  app.post("/v1/citizen/eligibility/rule-sets/:id/submit", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, ADMIN_ROLES);
    const { id } = idParam.parse(req.params);
    return reply.send(await commands.submitRuleSet(ctx, id));
  });

  app.post("/v1/citizen/eligibility/rule-sets/:id/publish", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, ADMIN_ROLES);
    const { id } = idParam.parse(req.params);
    return reply.send(await commands.publishRuleSet(ctx, id));
  });

  app.get("/v1/citizen/eligibility/rule-sets", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, OFFICER_ROLES);
    return reply.send({ data: await queries.listRuleSets(ctx.tenantId) });
  });

  app.get("/v1/citizen/eligibility/rule-sets/:id", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, OFFICER_ROLES);
    const { id } = idParam.parse(req.params);
    const rs = await queries.getRuleSet(ctx.tenantId, id);
    if (!rs) throw new HttpError(404, "NOT_FOUND", "rule set not found");
    return reply.send(rs);
  });

  // --- Evaluation + manual-review queue ---------------------------------------
  app.post("/v1/citizen/eligibility/evaluate", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, OFFICER_ROLES);
    const body = evaluateBody.parse(req.body);
    return reply.send(await commands.evaluate(ctx, body));
  });

  app.get("/v1/citizen/eligibility/manual-review", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, OFFICER_ROLES);
    return reply.send({ data: await queries.listManualReviewQueue(ctx.tenantId) });
  });

  app.get("/v1/citizen/eligibility/evaluations/:id", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, OFFICER_ROLES);
    const { id } = idParam.parse(req.params);
    const ev = await queries.getEvaluation(ctx.tenantId, id);
    if (!ev) throw new HttpError(404, "NOT_FOUND", "evaluation not found");
    return reply.send(ev);
  });

  app.post("/v1/citizen/eligibility/evaluations/:id/decision", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, OFFICER_ROLES);
    const { id } = idParam.parse(req.params);
    const body = reviewDecisionBody.parse(req.body);
    return reply.send(await commands.decideReview(ctx, id, body));
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
