import type { FastifyInstance } from "fastify";
import crypto from "node:crypto";
import { ZodError } from "zod";
import { resolveContext, requireRole, HttpError } from "../../shared/context.js";
import { queue } from "../../shared/infra.js";
import { createRuleBody, updateRuleBody, ruleIdParam, evaluateBody } from "./validators.js";
import * as commands from "./commands.js";
import * as queries from "./queries.js";
import type { AccessRequest } from "./domain.js";

const ADMIN = ["platform_admin", "super_admin", "tenant_admin"];

export async function abacRoutes(app: FastifyInstance): Promise<void> {
  // ── CRUD (admin-guarded, tenant-scoped) ─────────────────────────────
  app.post("/v1/policy/abac/rules", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, ADMIN);
    const body = createRuleBody.parse(req.body);
    return reply.code(202).send(await commands.createRule(ctx, body));
  });

  app.get("/v1/policy/abac/rules", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, ADMIN);
    return reply.send({ data: await queries.listRules(ctx.tenantId) });
  });

  app.get("/v1/policy/abac/rules/:id", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, ADMIN);
    const { id } = ruleIdParam.parse(req.params);
    const view = await queries.getRule(ctx.tenantId, id);
    if (!view) throw new HttpError(404, "NOT_FOUND", "abac rule not found");
    return reply.send(view);
  });

  app.patch("/v1/policy/abac/rules/:id", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, ADMIN);
    const { id } = ruleIdParam.parse(req.params);
    const body = updateRuleBody.parse(req.body);
    const view = await queries.getRule(ctx.tenantId, id);
    if (!view) throw new HttpError(404, "NOT_FOUND", "abac rule not found");
    return reply.code(202).send(await commands.updateRule(ctx, id, body));
  });

  app.delete("/v1/policy/abac/rules/:id", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, ADMIN);
    const { id } = ruleIdParam.parse(req.params);
    const view = await queries.getRule(ctx.tenantId, id);
    if (!view) throw new HttpError(404, "NOT_FOUND", "abac rule not found");
    return reply.code(202).send(await commands.deleteRule(ctx, id));
  });

  // ── decision endpoint ───────────────────────────────────────────────
  // Any authenticated caller may ask for a decision; evaluation is strictly
  // scoped to the caller's tenant, so cross-tenant rules are never consulted.
  app.post("/v1/policy/abac/evaluate", async (req, reply) => {
    const ctx = resolveContext(req);
    const body = evaluateBody.parse(req.body);
    const accessReq: AccessRequest = {
      subject: {
        ...(body.subject.id !== undefined ? { id: body.subject.id } : {}),
        roleIds: body.subject.roleIds,
        attrs: body.subject.attrs,
      },
      action: body.action,
      resource: { type: body.resource.type, attrs: body.resource.attrs },
      // tenantId is always the caller's tenant; a client-supplied context cannot
      // override it (prevents tenant spoofing in tenant-match predicates).
      context: { ...body.context, tenantId: ctx.tenantId },
    };
    const decision = await queries.evaluateAccess(ctx.tenantId, accessReq);

    // Emit decision to audit stream for compliance (allow + deny both logged)
    queue.publish("audit.event.record", {
      messageId: crypto.randomUUID(),
      type: "audit.event.record",
      tenantId: ctx.tenantId,
      actorId: ctx.actorId,
      correlationId: ctx.correlationId,
      schemaVersion: "1.0",
      payload: {
        eventType: "policy.decision",
        action: body.action,
        resourceType: body.resource.type,
        decision: decision.decision,
        reason: decision.reason,
        matchedRuleId: decision.matchedRuleId ?? null,
        subjectId: body.subject.id ?? ctx.actorId,
      },
    }).catch(() => { /* fire-and-forget audit */ });

    return reply.send(decision);
  });

  app.setErrorHandler((err, req, reply) => {
    const correlationId = (req.headers["x-correlation-id"] as string) ?? req.id;
    if (err instanceof ZodError) return reply.code(400).send({ code: "VALIDATION_FAILED", message: "invalid request", correlationId, retryable: false, fieldErrors: err.issues.map((i) => ({ field: i.path.join("."), message: i.message })) });
    if (err instanceof HttpError) return reply.code(err.status).send({ code: err.code, message: err.message, correlationId, retryable: false });
    req.log.error({ err }, "unhandled error");
    return reply.code(500).send({ code: "INTERNAL", message: "internal error", correlationId, retryable: true });
  });
}
