import type { FastifyInstance } from "fastify";
import { ZodError, z } from "zod";
import { sendAccepted } from "@civitasone/schemas/validate";
import { acceptedResponseSchema } from "@civitasone/schemas/common";
import { resolveContext, requireRole, HttpError } from "../../shared/context.js";
import { replyIfRateLimited } from "../../shared/rate-limit-error.js";
import * as repo from "./repo.js";
import * as commands from "./commands.js";

const ROLES = ["workflow_user", "workflow_admin", "super_admin", "tenant_admin"];
const ADMIN_ROLES = ["workflow_admin", "super_admin", "tenant_admin"];

function hasAdminRole(ctx: { roles: string[] }): boolean {
  return ctx.roles.some((r) => ADMIN_ROLES.includes(r));
}

/** Longest a delegation may run (inclusive, in days from fromDate to toDate). */
export const MAX_DELEGATION_DAYS = 90;

function daysBetween(from: string, to: string): number {
  return Math.round((Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / 86_400_000);
}

export async function delegationRoutes(app: FastifyInstance): Promise<void> {
  app.post("/v1/workflow/delegations", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, ROLES);
    const body = z.object({
      delegateId: z.string().uuid(),
      // Roles conveyed to the delegate. Required: a delegation with no role scope
      // would satisfy nothing, and the delegator must hold every role listed.
      roles: z.array(z.string().min(1).max(64)).min(1).max(20),
      fromDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
      // Mandatory end date: no open-ended delegations.
      toDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
      reason: z.string().max(256).optional(),
    }).parse(req.body);

    const span = daysBetween(body.fromDate, body.toDate);
    if (Number.isNaN(span) || span < 0) {
      throw new HttpError(400, "DELEGATION_BAD_RANGE", "toDate must be on or after fromDate");
    }
    if (span > MAX_DELEGATION_DAYS) {
      throw new HttpError(400, "DELEGATION_TOO_LONG", `a delegation may last at most ${MAX_DELEGATION_DAYS} days`);
    }

    // Privilege-escalation guard: you cannot delegate a role you do not hold.
    // Checked against the creator's token roles; without it two plain users
    // could mint a delegation that lets one complete the other's role-gated task.
    const roles = [...new Set(body.roles)];
    const unheld = roles.filter((r) => !ctx.roles.includes(r));
    if (unheld.length > 0) {
      throw new HttpError(403, "DELEGATION_ROLE_NOT_HELD",
        `you cannot delegate role(s) you do not hold: ${unheld.join(", ")}`);
    }

    return sendAccepted(reply, acceptedResponseSchema, await commands.createDelegation(ctx, {
      delegateId: body.delegateId,
      roles,
      fromDate: body.fromDate,
      toDate: body.toDate,
      ...(body.reason !== undefined ? { reason: body.reason } : {}),
    }));
  });

  app.get("/v1/workflow/delegations", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, ROLES);
    const isAdmin = hasAdminRole(ctx);
    const q = z.object({
      limit: z.coerce.number().int().min(1).max(200).default(50),
      offset: z.coerce.number().int().min(0).default(0),
      mine: z.enum(["true", "false"]).optional(),
      toMe: z.enum(["true", "false"]).optional(),
      delegatorId: z.string().uuid().optional(),
      delegateId: z.string().uuid().optional(),
    }).parse(req.query);
    // The id filters let a caller look at someone else's delegations: admin only.
    if ((q.delegatorId || q.delegateId) && !isAdmin) {
      throw new HttpError(403, "FORBIDDEN", "delegatorId / delegateId filters are admin-only");
    }
    const filter: repo.DelegationListFilter = {};
    if (q.mine === "true") filter.delegatorId = ctx.actorId;
    if (q.toMe === "true") filter.delegateId = ctx.actorId;
    if (q.delegatorId) {
      if (filter.delegatorId && filter.delegatorId !== q.delegatorId) return reply.send({ data: [], total: 0 });
      filter.delegatorId = q.delegatorId;
    }
    if (q.delegateId) {
      if (filter.delegateId && filter.delegateId !== q.delegateId) return reply.send({ data: [], total: 0 });
      filter.delegateId = q.delegateId;
    }
    // Plain users only ever see delegations they are party to; admins see the tenant.
    if (!isAdmin) filter.involving = ctx.actorId;
    const { rows, total } = await repo.listByTenant(ctx.tenantId, q.limit, q.offset, filter);
    return reply.send({ data: rows, total });
  });

  // Admin report: ACTIVE legacy delegations (created before role scoping; empty
  // roles, so they satisfy no role gate) with their creator (the delegator), so
  // they can be re-issued with an explicit role scope. Registered before any
  // parameterised route.
  app.get("/v1/workflow/delegations/legacy-report", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, ADMIN_ROLES);
    const q = z.object({
      limit: z.coerce.number().int().min(1).max(200).default(50),
      offset: z.coerce.number().int().min(0).default(0),
    }).parse(req.query);
    const { rows, total } = await repo.listLegacy(ctx.tenantId, q.limit, q.offset);
    return reply.send({
      data: rows.map((d) => ({
        id: d.id, createdBy: d.delegatorId, delegateId: d.delegateId,
        fromDate: d.fromDate, toDate: d.toDate, reason: d.reason, createdAt: d.createdAt,
      })),
      total,
    });
  });

  app.delete("/v1/workflow/delegations/:id", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, ROLES);
    const { id } = z.object({ id: z.string().uuid() }).parse(req.params);
    const existing = await repo.findById(id, ctx.tenantId);
    if (!existing) throw new HttpError(404, "NOT_FOUND", "delegation not found");
    // Ownership: only the delegator or a workflow admin may revoke. Refusals are audited.
    if (existing.delegatorId !== ctx.actorId && !hasAdminRole(ctx)) {
      await commands.refuseDelegationRevoke(ctx, id);
      throw new HttpError(403, "NOT_DELEGATOR", "only the delegator or a workflow admin may revoke this delegation");
    }
    return sendAccepted(reply, acceptedResponseSchema, await commands.revokeDelegation(ctx, id));
  });

  app.setErrorHandler((err, req, reply) => {
    const rateLimited = replyIfRateLimited(err, req, reply);
    if (rateLimited) return rateLimited;
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
