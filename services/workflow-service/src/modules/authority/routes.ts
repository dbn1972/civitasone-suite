import type { FastifyInstance } from "fastify";
import { ZodError, z } from "zod";
import { resolveContext, requireRole, HttpError } from "../../shared/context.js";
import * as repo from "./repo.js";
import type { AuthorityLimitRow } from "./schema.js";
import { evaluateAuthority, type AuthorityScope, type AuthorityType } from "./domain.js";

const ROLES = ["workflow_user", "workflow_admin", "super_admin", "tenant_admin"];
const ADMIN_ROLES = ["workflow_admin", "super_admin", "tenant_admin"];

const scopeEnum = z.enum(["role", "designation", "user"]);
const typeEnum = z.enum(["financial", "administrative"]);
const dateRe = /^\d{4}-\d{2}-\d{2}$/;

function view(r: AuthorityLimitRow) {
  return {
    id: r.id, scopeType: r.scopeType, scopeRef: r.scopeRef, authorityType: r.authorityType,
    currency: r.currency, maxAmount: Number(r.maxAmount), effectiveFrom: r.effectiveFrom,
    effectiveTo: r.effectiveTo ?? null, escalateToScopeType: r.escalateToScopeType ?? null,
    escalateToRef: r.escalateToRef ?? null, status: r.status,
    approvedBy: r.approvedBy ?? null,
  };
}

export async function authorityRoutes(app: FastifyInstance): Promise<void> {
  // CAP-025 — create a limit (maker). Persisted in DRAFT until a checker approves.
  app.post("/v1/workflow/authority/limits", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, ADMIN_ROLES);
    const body = z.object({
      scopeType: scopeEnum,
      scopeRef: z.string().min(1).max(128),
      authorityType: typeEnum.default("financial"),
      currency: z.string().min(1).max(8).default("INR"),
      maxAmount: z.number().int().nonnegative(), // paise
      effectiveFrom: z.string().regex(dateRe),
      effectiveTo: z.string().regex(dateRe).nullable().optional(),
      escalateToScopeType: scopeEnum.nullable().optional(),
      escalateToRef: z.string().max(128).nullable().optional(),
      reason: z.string().max(256).nullable().optional(),
    }).parse(req.body);

    const row = await repo.create({
      tenantId: ctx.tenantId,
      scopeType: body.scopeType,
      scopeRef: body.scopeRef,
      authorityType: body.authorityType,
      currency: body.currency,
      maxAmount: body.maxAmount,
      effectiveFrom: body.effectiveFrom,
      effectiveTo: body.effectiveTo ?? null,
      escalateToScopeType: body.escalateToScopeType ?? null,
      escalateToRef: body.escalateToRef ?? null,
      reason: body.reason ?? null,
      createdBy: ctx.actorId,
    });
    return reply.code(201).send({ data: view(row) });
  });

  // CAP-025 — maker-checker: approve (activate) a draft. Checker must differ
  // from the maker (segregation of duties).
  app.post("/v1/workflow/authority/limits/:id/approve", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, ADMIN_ROLES);
    const { id } = z.object({ id: z.string().uuid() }).parse(req.params);
    const existing = await repo.findById(id, ctx.tenantId);
    if (!existing) throw new HttpError(404, "NOT_FOUND", "authority limit not found");
    if (existing.createdBy === ctx.actorId) {
      throw new HttpError(409, "SELF_APPROVAL_FORBIDDEN", "the checker must differ from the maker");
    }
    if (existing.status !== "draft") {
      throw new HttpError(409, "NOT_DRAFT", `limit is ${existing.status}, not draft`);
    }
    const row = await repo.approve(id, ctx.tenantId, ctx.actorId);
    if (!row) throw new HttpError(409, "CONFLICT", "limit was not in draft state");
    return reply.send({ data: view(row) });
  });

  app.delete("/v1/workflow/authority/limits/:id", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, ADMIN_ROLES);
    const { id } = z.object({ id: z.string().uuid() }).parse(req.params);
    const row = await repo.revoke(id, ctx.tenantId);
    if (!row) throw new HttpError(404, "NOT_FOUND", "authority limit not found");
    return reply.send({ data: view(row) });
  });

  app.get("/v1/workflow/authority/limits", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, ROLES);
    const q = z.object({
      limit: z.coerce.number().int().min(1).max(200).default(100),
      offset: z.coerce.number().int().min(0).default(0),
    }).parse(req.query);
    const rows = await repo.listByTenant(ctx.tenantId, q.limit, q.offset);
    return reply.send({ data: rows.map(view) });
  });

  // CAP-025 — evaluate an amount against the matrix: is it within the actor's
  // authority, and if not, what is the escalation chain / final approver?
  app.post("/v1/workflow/authority/check", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, ROLES);
    const body = z.object({
      authorityType: typeEnum.default("financial"),
      amount: z.number().nonnegative(),
      onDate: z.string().regex(dateRe).optional(),
      scopes: z.array(z.object({ scopeType: scopeEnum, scopeRef: z.string().min(1).max(128) })).min(1),
    }).parse(req.body);

    const onDate = body.onDate ?? new Date().toISOString().slice(0, 10);
    const limits = await repo.activeLimits(ctx.tenantId);
    const decision = evaluateAuthority(
      limits,
      { scopes: body.scopes as Array<{ scopeType: AuthorityScope; scopeRef: string }> },
      body.authorityType as AuthorityType,
      body.amount,
      onDate,
    );
    return reply.send({ data: decision });
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
