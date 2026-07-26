import type { FastifyInstance } from "fastify";
import { z, ZodError } from "zod";
import { resolveContext, requireRole, HttpError } from "../../shared/context.js";
import * as repo from "./repo.js";
import { validateLink, planSplit, planMerge, type LinkType } from "./domain.js";

const ADMIN = ["super_admin", "workflow_admin", "case_manager", "tenant_admin"];

export async function caseLinksRoutes(app: FastifyInstance): Promise<void> {
  // CAP-033 — list every link touching a case.
  app.get("/v1/workflow/cases/:id/links", async (req, reply) => {
    const ctx = resolveContext(req); requireRole(ctx, ADMIN);
    const { id } = z.object({ id: z.string().uuid() }).parse(req.params);
    const links = await repo.linksForCase(ctx.tenantId, id);
    return reply.send({ data: links, meta: { total: links.length } });
  });

  // CAP-033 — link a case to another (parent-child / related / duplicate-of).
  app.post("/v1/workflow/cases/:id/links", async (req, reply) => {
    const ctx = resolveContext(req); requireRole(ctx, ADMIN);
    const { id } = z.object({ id: z.string().uuid() }).parse(req.params);
    const body = z.object({
      toCaseId: z.string().uuid(),
      linkType: z.enum(["parent_child", "related", "duplicate_of", "split_from", "merged_from"]),
      reason: z.string().max(500).optional(),
    }).parse(req.body);

    if (!(await repo.caseExists(ctx.tenantId, id))) throw new HttpError(404, "NOT_FOUND", "from case not found");
    if (!(await repo.caseExists(ctx.tenantId, body.toCaseId))) throw new HttpError(404, "NOT_FOUND", "to case not found");

    const existing = await repo.allLinks(ctx.tenantId);
    const guard = validateLink({ fromCaseId: id, toCaseId: body.toCaseId, type: body.linkType as LinkType, existing });
    if (!guard.allowed) {
      const status = guard.errors.includes("CYCLE_DETECTED") || guard.errors.includes("DUPLICATE_LINK") ? 409 : 400;
      throw new HttpError(status, "LINK_REJECTED", `link rejected: ${guard.errors.join(", ")}`);
    }
    const row = await repo.createLink({
      tenantId: ctx.tenantId, fromCaseId: id, toCaseId: body.toCaseId,
      linkType: body.linkType as LinkType, reason: body.reason, actorId: ctx.actorId, correlationId: ctx.correlationId,
    });
    return reply.code(201).send({ data: row });
  });

  // CAP-033 — split a case into >= 2 children with optional allocation (sum 100).
  app.post("/v1/workflow/cases/:id/split", async (req, reply) => {
    const ctx = resolveContext(req); requireRole(ctx, ADMIN);
    const { id } = z.object({ id: z.string().uuid() }).parse(req.params);
    const body = z.object({
      children: z.array(z.object({
        title: z.string().min(1).max(256),
        caseType: z.string().min(1).max(64),
        allocation: z.number().gt(0).lte(100).optional(),
        assigneeId: z.string().uuid().optional(),
      })).min(2).max(20),
    }).parse(req.body);

    if (!(await repo.caseExists(ctx.tenantId, id))) throw new HttpError(404, "NOT_FOUND", "case not found");
    const plan = planSplit(body.children);
    if (!plan.allowed) throw new HttpError(400, "SPLIT_REJECTED", `split rejected: ${plan.errors.join(", ")}`);

    const childIds = await repo.persistSplit({
      tenantId: ctx.tenantId, parentCaseId: id, children: body.children,
      actorId: ctx.actorId, correlationId: ctx.correlationId,
    });
    return reply.code(201).send({ data: { parentCaseId: id, childIds, childCount: childIds.length } });
  });

  // CAP-033 — merge >= 2 source cases into a target (lineage preserved).
  app.post("/v1/workflow/cases/merge", async (req, reply) => {
    const ctx = resolveContext(req); requireRole(ctx, ADMIN);
    const body = z.object({
      sourceIds: z.array(z.string().uuid()).min(2).max(50),
      targetId: z.string().uuid(),
      reason: z.string().min(1).max(500),
    }).parse(req.body);

    const plan = planMerge(body.sourceIds, body.targetId);
    if (!plan.allowed) throw new HttpError(400, "MERGE_REJECTED", `merge rejected: ${plan.errors.join(", ")}`);
    if (!(await repo.caseExists(ctx.tenantId, body.targetId))) throw new HttpError(404, "NOT_FOUND", "target case not found");

    const merged = await repo.persistMerge({
      tenantId: ctx.tenantId, sourceIds: body.sourceIds, targetId: body.targetId,
      reason: body.reason, actorId: ctx.actorId, correlationId: ctx.correlationId,
    });
    return reply.send({ data: { targetId: body.targetId, mergedCount: merged } });
  });

  app.setErrorHandler((err, req, reply) => {
    const cid = (req.headers["x-correlation-id"] as string) ?? req.id;
    if (err instanceof ZodError) return reply.code(400).send({ code: "VALIDATION_FAILED", message: "invalid request", correlationId: cid });
    if (err instanceof HttpError) return reply.code(err.status).send({ code: err.code, message: err.message, correlationId: cid });
    req.log.error({ err }, "unhandled"); return reply.code(500).send({ code: "INTERNAL", message: "internal error", correlationId: cid });
  });
}
