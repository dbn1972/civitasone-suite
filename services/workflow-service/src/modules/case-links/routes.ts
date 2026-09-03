import type { FastifyInstance } from "fastify";
import { z, ZodError } from "zod";
import { sendAccepted } from "@civitasone/schemas/validate";
import { acceptedResponseSchema } from "@civitasone/schemas/common";
import { resolveContext, requireRole, HttpError } from "../../shared/context.js";
import * as repo from "./repo.js";
import * as commands from "./commands.js";
import { planSplit, planMerge, validateLink, type LinkType } from "./domain.js";

const ADMIN = ["super_admin", "workflow_admin", "case_manager", "tenant_admin"];

// Guard errors that can be decided from a read-only snapshot of the tenant's
// current links (cycle/duplicate detection) map to 409 CONFLICT; structural
// input errors (self-link, unknown type) map to 400. Kept here rather than in
// domain.ts because the HTTP status is a route concern, not a domain one.
const CONFLICT_ERRORS = new Set(["CYCLE_DETECTED", "DUPLICATE_LINK"]);

export async function caseLinksRoutes(app: FastifyInstance): Promise<void> {
  app.get("/v1/workflow/cases/:id/links", async (req, reply) => {
    const ctx = resolveContext(req); requireRole(ctx, ADMIN);
    const { id } = z.object({ id: z.string().uuid() }).parse(req.params);
    const links = await repo.linksForCase(ctx.tenantId, id);
    return reply.send({ data: links, meta: { total: links.length } });
  });

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

    // Synchronous pre-check (PR #169 regression guard): the actual insert now
    // happens in the async consumer, but cycle/duplicate detection is a pure,
    // read-only function of the tenant's CURRENTLY COMMITTED links, so we can
    // still reject a doomed request before ever enqueueing it -- matching the
    // route's pre-CQRS behavior for the common (non-racing) case. This is a
    // best-effort check, not a substitute for the consumer's own lock-and-
    // recheck: two requests racing the same pair can both pass this read and
    // both get enqueued, in which case the consumer's row-locked
    // createLinkChecked is still the sole source of truth for which one
    // actually persists.
    const existing = await repo.allLinks(ctx.tenantId);
    const guard = validateLink({ fromCaseId: id, toCaseId: body.toCaseId, type: body.linkType as LinkType, existing });
    if (!guard.allowed) {
      const status = guard.errors.some((e) => CONFLICT_ERRORS.has(e)) ? 409 : 400;
      throw new HttpError(status, guard.errors[0]!, `link rejected: ${guard.errors.join(", ")}`);
    }

    return sendAccepted(reply, acceptedResponseSchema, await commands.createCaseLink(ctx, {
      fromCaseId: id,
      toCaseId: body.toCaseId,
      linkType: body.linkType as LinkType,
      ...(body.reason !== undefined ? { reason: body.reason } : {}),
    }));
  });

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

    const status = await repo.caseStatus(ctx.tenantId, id);
    if (status === undefined) throw new HttpError(404, "NOT_FOUND", "case not found");
    const plan = planSplit(body.children);
    if (!plan.allowed) throw new HttpError(400, "SPLIT_REJECTED", `split rejected: ${plan.errors.join(", ")}`);
    // Synchronous pre-check mirroring persistSplit's own guard (see repo.ts):
    // best-effort, the consumer's FOR UPDATE lock is still the sole source of
    // truth for a request that races a concurrent split of the same parent.
    if (status !== "open") throw new HttpError(409, "CASE_NOT_OPEN", `case not open for split (status=${status})`);

    return sendAccepted(reply, acceptedResponseSchema, await commands.splitCase(ctx, {
      parentCaseId: id,
      children: body.children,
    }));
  });

  app.post("/v1/workflow/cases/merge", async (req, reply) => {
    const ctx = resolveContext(req); requireRole(ctx, ADMIN);
    const body = z.object({
      sourceIds: z.array(z.string().uuid()).min(2).max(50),
      targetId: z.string().uuid(),
      reason: z.string().min(1).max(500),
    }).parse(req.body);

    const plan = planMerge(body.sourceIds, body.targetId);
    if (!plan.allowed) throw new HttpError(400, "MERGE_REJECTED", `merge rejected: ${plan.errors.join(", ")}`);
    const targetStatus = await repo.caseStatus(ctx.tenantId, body.targetId);
    if (targetStatus === undefined) throw new HttpError(404, "NOT_FOUND", "target case not found");
    // Synchronous pre-check mirroring persistMerge's own guard (see repo.ts):
    // best-effort, the consumer's FOR UPDATE lock is still the sole source of
    // truth for a request that races a concurrent split/merge of a source.
    // Non-existent sources are tolerated here too (persistMerge skips them).
    if (targetStatus !== "open") throw new HttpError(409, "CASE_NOT_OPEN", `target case not open for merge (status=${targetStatus})`);
    for (const sourceId of body.sourceIds) {
      if (sourceId === body.targetId) continue;
      const sourceStatus = await repo.caseStatus(ctx.tenantId, sourceId);
      if (sourceStatus !== undefined && sourceStatus !== "open") {
        throw new HttpError(409, "CASE_NOT_OPEN", `source case not open for merge (id=${sourceId}, status=${sourceStatus})`);
      }
    }

    return sendAccepted(reply, acceptedResponseSchema, await commands.mergeCases(ctx, body));
  });

  app.setErrorHandler((err, req, reply) => {
    const cid = (req.headers["x-correlation-id"] as string) ?? req.id;
    if (err instanceof ZodError) return reply.code(400).send({ code: "VALIDATION_FAILED", message: "invalid request", correlationId: cid });
    if (err instanceof HttpError) return reply.code(err.status).send({ code: err.code, message: err.message, correlationId: cid });
    req.log.error({ err }, "unhandled"); return reply.code(500).send({ code: "INTERNAL", message: "internal error", correlationId: cid });
  });
}
