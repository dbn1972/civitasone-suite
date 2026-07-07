import { sendAccepted } from "@civitasone/schemas/validate";
import { acceptedResponseSchema } from "@civitasone/schemas/common";
import type { FastifyInstance } from "fastify";
import { ZodError } from "zod";
import { resolveContext, requireRole, HttpError } from "../../shared/context.js";
import { createClauseBody, updateClauseBody, clauseIdParam, clauseListQuery, deleteClauseBody } from "./validators.js";
import * as commands from "./commands.js";
import * as queries from "./queries.js";
import * as repo from "./repo.js";
import { MAX_CLAUSES_PER_TENANT } from "./domain.js";

const CLAUSE_WRITE_ROLES = ["procurement_admin", "finance_admin", "super_admin", "legal_officer", "contract_admin"];
const CLAUSE_READ_ROLES = [...CLAUSE_WRITE_ROLES, "audit_officer", "procurement_officer", "finance_officer"];

export async function clauseRoutes(app: FastifyInstance): Promise<void> {
  // ── Create clause ─────────────────────────────────────────────────────
  app.post("/v1/contract/clauses", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, CLAUSE_WRITE_ROLES);
    const body = createClauseBody.parse(req.body);

    // Enforce max 10,000 clauses per tenant
    const count = await repo.countClausesByTenant(ctx.tenantId);
    if (count >= MAX_CLAUSES_PER_TENANT) {
      throw new HttpError(422, "CLAUSE_LIMIT_REACHED", `maximum ${MAX_CLAUSES_PER_TENANT} clauses per tenant reached`);
    }

    return sendAccepted(reply, acceptedResponseSchema, await commands.createClause(ctx, body));
  });

  // ── List clauses (with filtering) ─────────────────────────────────────
  app.get("/v1/contract/clauses", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, CLAUSE_READ_ROLES);
    const q = clauseListQuery.parse(req.query);
    const opts: { limit: number; offset: number; category?: string; jurisdiction?: string } = {
      limit: q.limit,
      offset: q.offset,
    };
    if (q.category) opts.category = q.category;
    if (q.jurisdiction) opts.jurisdiction = q.jurisdiction;
    const { data, total } = await queries.listClauses(ctx.tenantId, opts);
    return reply.send({
      data,
      meta: { page: Math.floor(q.offset / q.limit) + 1, pageSize: q.limit, total },
    });
  });

  // ── Get single clause ─────────────────────────────────────────────────
  app.get("/v1/contract/clauses/:id", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, CLAUSE_READ_ROLES);
    const { id } = clauseIdParam.parse(req.params);
    const clause = await queries.getClause(id, ctx.tenantId);
    if (!clause) throw new HttpError(404, "NOT_FOUND", "clause not found");
    return reply.send({ data: clause });
  });

  // ── Update clause (optimistic locking) ────────────────────────────────
  app.patch("/v1/contract/clauses/:id", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, CLAUSE_WRITE_ROLES);
    const { id } = clauseIdParam.parse(req.params);
    const body = updateClauseBody.parse(req.body);

    // Verify clause exists and belongs to tenant
    const existing = await queries.getClause(id, ctx.tenantId);
    if (!existing) throw new HttpError(404, "NOT_FOUND", "clause not found");
    if (existing.status === "archived") throw new HttpError(409, "ARCHIVED", "cannot update archived clause");
    if (existing.version !== body.version) {
      throw new HttpError(409, "VERSION_CONFLICT", "clause has been modified by another user");
    }

    return sendAccepted(reply, acceptedResponseSchema, await commands.updateClause(ctx, id, body));
  });

  // ── Delete (archive) clause ───────────────────────────────────────────
  app.delete("/v1/contract/clauses/:id", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, CLAUSE_WRITE_ROLES);
    const { id } = clauseIdParam.parse(req.params);
    const body = deleteClauseBody.parse(req.body);

    const existing = await queries.getClause(id, ctx.tenantId);
    if (!existing) throw new HttpError(404, "NOT_FOUND", "clause not found");
    if (existing.status === "archived") throw new HttpError(409, "ALREADY_ARCHIVED", "clause is already archived");
    if (existing.version !== body.version) {
      throw new HttpError(409, "VERSION_CONFLICT", "clause has been modified by another user");
    }

    return sendAccepted(reply, acceptedResponseSchema, await commands.archiveClause(ctx, id, body.version));
  });

  // ── Error handler (same pattern as contractRoutes) ────────────────────
  app.setErrorHandler((err: unknown, req, reply) => {
    const correlationId = (req.headers["x-correlation-id"] as string) ?? req.id;
    if (err instanceof ZodError) {
      void reply.code(400).send({
        code: "VALIDATION_FAILED",
        message: "invalid request",
        correlationId,
        retryable: false,
        fieldErrors: err.issues.map((i) => ({ field: i.path.join("."), message: i.message })),
      });
      return;
    }
    if (err instanceof HttpError) {
      void reply.code(err.status).send({ code: err.code, message: err.message, correlationId, retryable: false });
      return;
    }
    req.log.error({ err }, "unhandled error");
    void reply.code(500).send({ code: "INTERNAL", message: "internal error", correlationId, retryable: true });
  });
}
