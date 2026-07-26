import type { FastifyInstance } from "fastify";
import { z, ZodError } from "zod";
import { resolveContext, requireRole, HttpError } from "../../shared/context.js";
import * as repo from "./repo.js";
import { validateRaise, canReview, canRevoke, decisionStatus } from "./domain.js";

const USER = ["workflow_user", "workflow_admin", "super_admin", "tenant_admin", "case_manager"];
const APPROVER = ["workflow_admin", "super_admin", "tenant_admin", "case_manager"];

export async function deviationsRoutes(app: FastifyInstance): Promise<void> {
  // CAP-039 — raise a deviation/waiver against any entity.
  app.post("/v1/workflow/deviations", async (req, reply) => {
    const ctx = resolveContext(req); requireRole(ctx, USER);
    const body = z.object({
      entityType: z.string().min(1).max(48),
      entityId: z.string().uuid(),
      deviationType: z.string().min(1).max(48),
      reason: z.string().min(1).max(4000),
      expiresAt: z.string().datetime().optional(),
    }).parse(req.body);
    const guard = validateRaise(body.reason);
    if (!guard.allowed) throw new HttpError(400, "INVALID", guard.errors.join(", "));
    const row = await repo.raise({
      tenantId: ctx.tenantId, entityType: body.entityType, entityId: body.entityId,
      deviationType: body.deviationType, reason: body.reason,
      expiresAt: body.expiresAt ? new Date(body.expiresAt) : null,
      actorId: ctx.actorId, correlationId: ctx.correlationId,
    });
    return reply.code(201).send({ data: row });
  });

  // CAP-039 — deviations for an entity.
  app.get("/v1/workflow/deviations", async (req, reply) => {
    const ctx = resolveContext(req); requireRole(ctx, USER);
    const q = z.object({ entityType: z.string().min(1), entityId: z.string().uuid() }).parse(req.query);
    const data = await repo.listForEntity(ctx.tenantId, q.entityType, q.entityId);
    return reply.send({ data, meta: { total: data.length } });
  });

  // CAP-039 — register of active (approved, unexpired) waivers.
  app.get("/v1/workflow/deviations/active", async (req, reply) => {
    const ctx = resolveContext(req); requireRole(ctx, USER);
    const data = await repo.listActive(ctx.tenantId);
    return reply.send({ data, meta: { total: data.length } });
  });

  // CAP-039 — approve or reject (maker-checker enforced).
  app.post("/v1/workflow/deviations/:id/review", async (req, reply) => {
    const ctx = resolveContext(req); requireRole(ctx, APPROVER);
    const { id } = z.object({ id: z.string().uuid() }).parse(req.params);
    const body = z.object({ decision: z.enum(["approve", "reject"]), note: z.string().max(1000).optional() }).parse(req.body);
    const row = await repo.find(ctx.tenantId, id);
    if (!row) throw new HttpError(404, "NOT_FOUND", "deviation not found");
    const guard = canReview(repo.toState(row), ctx.actorId);
    if (!guard.allowed) {
      const status = guard.errors.includes("MAKER_CHECKER_VIOLATION") ? 403 : 409;
      throw new HttpError(status, "REVIEW_BLOCKED", guard.errors.join(", "));
    }
    const updated = await repo.review({
      tenantId: ctx.tenantId, id, status: decisionStatus(body.decision),
      reviewerId: ctx.actorId, note: body.note, correlationId: ctx.correlationId,
    });
    if (!updated) throw new HttpError(409, "ALREADY_REVIEWED", "deviation is no longer pending");
    return reply.send({ data: updated });
  });

  // CAP-039 — revoke an active waiver.
  app.post("/v1/workflow/deviations/:id/revoke", async (req, reply) => {
    const ctx = resolveContext(req); requireRole(ctx, APPROVER);
    const { id } = z.object({ id: z.string().uuid() }).parse(req.params);
    const row = await repo.find(ctx.tenantId, id);
    if (!row) throw new HttpError(404, "NOT_FOUND", "deviation not found");
    const guard = canRevoke(repo.toState(row));
    if (!guard.allowed) throw new HttpError(409, "REVOKE_BLOCKED", guard.errors.join(", "));
    const updated = await repo.revoke(ctx.tenantId, id, ctx.actorId, ctx.correlationId);
    if (!updated) throw new HttpError(409, "REVOKE_BLOCKED", "deviation is not active");
    return reply.send({ data: updated });
  });

  app.setErrorHandler((err, req, reply) => {
    const cid = (req.headers["x-correlation-id"] as string) ?? req.id;
    if (err instanceof ZodError) return reply.code(400).send({ code: "VALIDATION_FAILED", message: "invalid request", correlationId: cid });
    if (err instanceof HttpError) return reply.code(err.status).send({ code: err.code, message: err.message, correlationId: cid });
    req.log.error({ err }, "unhandled"); return reply.code(500).send({ code: "INTERNAL", message: "internal error", correlationId: cid });
  });
}
