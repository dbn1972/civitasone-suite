import type { FastifyInstance } from "fastify";
import { ZodError, z } from "zod";
import { sendAccepted } from "@civitasone/schemas/validate";
import { acceptedResponseSchema } from "@civitasone/schemas/common";
import { resolveContext, requireRole, HttpError } from "../../shared/context.js";
import * as repo from "./repo.js";
import * as commands from "./commands.js";
import { canReverse, assessImpact, assertEditable, type Dependency } from "./domain.js";

const ROLES = ["workflow_user", "workflow_admin", "super_admin", "tenant_admin"];
const ADMIN_ROLES = ["workflow_admin", "super_admin", "tenant_admin"];
const REVERSAL_ROLES = ["super_admin", "tenant_admin"];
function hasRole(roles: string[], allowed: string[]): boolean { return roles.some((r) => allowed.includes(r)); }

const dependencySchema = z.object({
  type: z.string().min(1).max(64), id: z.string().min(1).max(128),
  blocking: z.boolean().default(false), detail: z.string().max(256).optional(),
});

export async function finalizationRoutes(app: FastifyInstance): Promise<void> {
  app.post("/v1/workflow/instances/:id/finalize", async (req, reply) => {
    const ctx = resolveContext(req); requireRole(ctx, ADMIN_ROLES);
    const { id } = z.object({ id: z.string().uuid() }).parse(req.params);
    // Synchronous pre-check: the consumer silently no-ops a finalize for an
    // instance that already has a finalization row (unique(instance_id) is
    // the backstop), which used to be a synchronous 409 to the caller before
    // the async conversion. A read-only lookup of the currently-committed
    // row lets the common "already finalized" request still 409 immediately;
    // a request racing a concurrent finalize is still resolved correctly (as
    // a silent no-op) by the consumer's own existence check.
    const existing = await repo.findByInstance(id, ctx.tenantId);
    if (existing) throw new HttpError(409, "ALREADY_FINALIZED", "instance is already finalized");
    return sendAccepted(reply, acceptedResponseSchema, await commands.finalizeInstance(ctx, id));
  });

  app.get("/v1/workflow/instances/:id/finalization", async (req, reply) => {
    const ctx = resolveContext(req); requireRole(ctx, ROLES);
    const { id } = z.object({ id: z.string().uuid() }).parse(req.params);
    const row = await repo.findByInstance(id, ctx.tenantId);
    return reply.send({ data: repo.toState(row) });
  });

  app.post("/v1/workflow/instances/:id/reversal-impact", async (req, reply) => {
    const ctx = resolveContext(req); requireRole(ctx, ROLES);
    const { id } = z.object({ id: z.string().uuid() }).parse(req.params);
    const body = z.object({ dependencies: z.array(dependencySchema).default([]) }).parse(req.body ?? {});
    return reply.send({ data: assessImpact(id, body.dependencies as Dependency[]) });
  });

  app.post("/v1/workflow/instances/:id/reverse", async (req, reply) => {
    const ctx = resolveContext(req); requireRole(ctx, ADMIN_ROLES);
    const { id } = z.object({ id: z.string().uuid() }).parse(req.params);
    const body = z.object({ reason: z.string().min(1).max(512), dependencies: z.array(dependencySchema).default([]) }).parse(req.body);
    const row = await repo.findByInstance(id, ctx.tenantId);
    const state = repo.toState(row);
    if (!state) throw new HttpError(404, "NOT_FINALIZED", "instance is not finalized");
    const guard = canReverse({ state, hasAuthority: hasRole(ctx.roles, REVERSAL_ROLES), reason: body.reason, dependencies: body.dependencies as Dependency[] });
    if (!guard.allowed) {
      const status = guard.errors.includes("NO_REVERSAL_AUTHORITY") ? 403 : 409;
      throw new HttpError(status, "REVERSAL_BLOCKED", `reversal blocked: ${guard.errors.join(", ")}`);
    }
    const impact = assessImpact(id, body.dependencies as Dependency[]);
    return sendAccepted(reply, acceptedResponseSchema, await commands.reverseInstance(ctx, id, { reason: body.reason, impact }));
  });

  app.post("/v1/workflow/instances/:id/guarded-edit", async (req, reply) => {
    const ctx = resolveContext(req); requireRole(ctx, ROLES);
    const { id } = z.object({ id: z.string().uuid() }).parse(req.params);
    const row = await repo.findByInstance(id, ctx.tenantId);
    const guard = assertEditable(repo.toState(row));
    if (!guard.allowed) throw new HttpError(409, "INSTANCE_FINALIZED", "finalized record is protected from edits; reverse it first");
    return reply.send({ data: { editable: true } });
  });

  app.setErrorHandler((err, req, reply) => {
    const correlationId = (req.headers["x-correlation-id"] as string) ?? req.id;
    if (err instanceof ZodError) return reply.code(400).send({ code: "VALIDATION_FAILED", message: "invalid request", correlationId, retryable: false });
    if (err instanceof HttpError) return reply.code(err.status).send({ code: err.code, message: err.message, correlationId, retryable: false });
    req.log.error({ err }, "unhandled error");
    return reply.code(500).send({ code: "INTERNAL", message: "internal error", correlationId, retryable: true });
  });
}
