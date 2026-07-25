import type { FastifyInstance } from "fastify";
import { ZodError, z } from "zod";
import { resolveContext, requireRole, HttpError } from "../../shared/context.js";
import * as repo from "./repo.js";
import { canReverse, assessImpact, assertEditable, type Dependency } from "./domain.js";

const ROLES = ["workflow_user", "workflow_admin", "super_admin", "tenant_admin"];
const ADMIN_ROLES = ["workflow_admin", "super_admin", "tenant_admin"];
// Reversing a finalized record is a privileged act — a dedicated authority.
const REVERSAL_ROLES = ["super_admin", "tenant_admin"];

function hasRole(roles: string[], allowed: string[]): boolean {
  return roles.some((r) => allowed.includes(r));
}

export async function finalizationRoutes(app: FastifyInstance): Promise<void> {
  // CAP-029 — finalize an instance (protects it from further edits).
  app.post("/v1/workflow/instances/:id/finalize", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, ADMIN_ROLES);
    const { id } = z.object({ id: z.string().uuid() }).parse(req.params);
    const res = await repo.finalize(ctx.tenantId, id, ctx.actorId, ctx.correlationId);
    if (res === null) throw new HttpError(404, "NOT_FOUND", "instance not found");
    if ("conflict" in res) throw new HttpError(409, "ALREADY_FINALIZED", "instance already finalized");
    return reply.code(201).send({ data: repo.toState(res) });
  });

  // CAP-029 — finalization status for an instance.
  app.get("/v1/workflow/instances/:id/finalization", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, ROLES);
    const { id } = z.object({ id: z.string().uuid() }).parse(req.params);
    const row = await repo.findByInstance(id, ctx.tenantId);
    return reply.send({ data: repo.toState(row) });
  });

  // CAP-029 — impact assessment (dry-run): what would a reversal touch?
  app.post("/v1/workflow/instances/:id/reversal-impact", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, ROLES);
    const { id } = z.object({ id: z.string().uuid() }).parse(req.params);
    const body = z.object({ dependencies: z.array(dependencySchema).default([]) }).parse(req.body ?? {});
    const impact = assessImpact(id, body.dependencies as Dependency[]);
    return reply.send({ data: impact });
  });

  // CAP-029 — reverse (unfinalize). Requires reversal authority + reason +
  // dependency check; the pure domain guard is the gate.
  app.post("/v1/workflow/instances/:id/reverse", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, ADMIN_ROLES);
    const { id } = z.object({ id: z.string().uuid() }).parse(req.params);
    const body = z.object({
      reason: z.string().min(1).max(512),
      dependencies: z.array(dependencySchema).default([]),
    }).parse(req.body);

    const row = await repo.findByInstance(id, ctx.tenantId);
    const state = repo.toState(row);
    if (!state) throw new HttpError(404, "NOT_FINALIZED", "instance is not finalized");

    const hasAuthority = hasRole(ctx.roles, REVERSAL_ROLES);
    const guard = canReverse({
      state,
      hasAuthority,
      reason: body.reason,
      dependencies: body.dependencies as Dependency[],
    });
    if (!guard.allowed) {
      const status = guard.errors.includes("NO_REVERSAL_AUTHORITY") ? 403 : 409;
      throw new HttpError(status, "REVERSAL_BLOCKED", `reversal blocked: ${guard.errors.join(", ")}`);
    }

    const impact = assessImpact(id, body.dependencies as Dependency[]);
    const updated = await repo.reverse(ctx.tenantId, id, ctx.actorId, body.reason, impact, ctx.correlationId);
    if (!updated) throw new HttpError(409, "ALREADY_REVERSED", "instance already reversed");
    return reply.send({ data: repo.toState(updated), impact });
  });

  // CAP-029 — demonstrate the edit guard: mutating a finalized instance 409s.
  app.post("/v1/workflow/instances/:id/guarded-edit", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, ROLES);
    const { id } = z.object({ id: z.string().uuid() }).parse(req.params);
    const row = await repo.findByInstance(id, ctx.tenantId);
    const guard = assertEditable(repo.toState(row));
    if (!guard.allowed) {
      throw new HttpError(409, "INSTANCE_FINALIZED", "finalized record is protected from edits; reverse it first");
    }
    return reply.send({ data: { editable: true } });
  });

  app.setErrorHandler((err, req, reply) => {
    const correlationId = (req.headers["x-correlation-id"] as string) ?? req.id;
    if (err instanceof ZodError) {
      return reply.code(400).send({ code: "VALIDATION_FAILED", message: "invalid request", correlationId, retryable: false });
    }
    if (err instanceof HttpError) {
      return reply.code(err.status).send({ code: err.code, message: err.message, correlationId, retryable: false });
    }
    req.log.error({ err }, "unhandled error");
    return reply.code(500).send({ code: "INTERNAL", message: "internal error", correlationId, retryable: true });
  });
}

const dependencySchema = z.object({
  type: z.string().min(1).max(64),
  id: z.string().min(1).max(128),
  blocking: z.boolean().default(false),
  detail: z.string().max(256).optional(),
});
