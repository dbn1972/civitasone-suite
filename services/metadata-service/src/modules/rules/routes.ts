/**
 * Validation-rule CRUD (CAP-112 — completes the entity/field/layout/rule model).
 *
 *   GET    /v1/metadata/entities/:entityId/validation-rules
 *   POST   /v1/metadata/entities/:entityId/validation-rules
 *   PATCH  /v1/metadata/validation-rules/:id
 *   DELETE /v1/metadata/validation-rules/:id  (deactivate)
 *
 * Rule expressions are parsed at write time so a malformed rule is rejected 400
 * rather than silently failing at record-validation time.
 */
import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { eq, and, asc } from "drizzle-orm";
import { resolveContext, requireRole, HttpError } from "../../shared/context.js";
import { withTenant } from "../../shared/scope.js";
import { registerErrorHandler } from "../../shared/errors.js";
import { ADMIN } from "../../shared/roles.js";
import { entityDefinitions, validationRules } from "../entities/schema.js";
import { createItem, updateItem, deleteItem } from "./commands.js";
import { evaluateExpression } from "./domain.js";

function assertParses(expression: string): void {
  try {
    evaluateExpression(expression, {});
  } catch (err) {
    throw new HttpError(400, "RULE_EXPRESSION_INVALID", err instanceof Error ? err.message : "invalid expression");
  }
}

export async function validationRuleRoutes(app: FastifyInstance): Promise<void> {
  // Tenant-wide flat list for the /metadata/rules overview page.
  app.get("/v1/metadata/rules", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, ADMIN);
    const rows = await withTenant(ctx.tenantId, (tx) =>
      tx.select().from(validationRules)
        .where(eq(validationRules.tenantId, ctx.tenantId))
        .orderBy(asc(validationRules.sortOrder)),
    );
    return reply.send({ data: rows, meta: { total: rows.length } });
  });

  app.get("/v1/metadata/entities/:entityId/validation-rules", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, ADMIN);
    const { entityId } = z.object({ entityId: z.string().uuid() }).parse(req.params);
    const rows = await withTenant(ctx.tenantId, (tx) =>
      tx.select().from(validationRules)
        .where(and(eq(validationRules.entityDefId, entityId), eq(validationRules.tenantId, ctx.tenantId)))
        .orderBy(asc(validationRules.sortOrder)),
    );
    return reply.send({ data: rows, meta: { total: rows.length } });
  });

  app.post("/v1/metadata/entities/:entityId/validation-rules", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, ADMIN);
    const { entityId } = z.object({ entityId: z.string().uuid() }).parse(req.params);
    const body = z.object({
      name: z.string().min(1).max(256),
      expression: z.string().min(1).max(2000),
      errorMessage: z.string().min(1).max(512),
      sortOrder: z.number().int().min(0).max(9999).default(0),
    }).parse(req.body);
    assertParses(body.expression);

    const parent = await withTenant(ctx.tenantId, (tx) =>
      tx.select().from(entityDefinitions)
        .where(and(eq(entityDefinitions.id, entityId), eq(entityDefinitions.tenantId, ctx.tenantId))).limit(1));
    if (!parent[0]) throw new HttpError(404, "NOT_FOUND", "Entity definition not found");
    return reply.code(202).send({ data: await createItem(ctx, { ...body, entityId }) });
  });

  app.patch("/v1/metadata/validation-rules/:id", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, ADMIN);
    const { id } = z.object({ id: z.string().uuid() }).parse(req.params);
    const body = z.object({
      name: z.string().min(1).max(256).optional(),
      expression: z.string().min(1).max(2000).optional(),
      errorMessage: z.string().min(1).max(512).optional(),
      isActive: z.boolean().optional(),
      sortOrder: z.number().int().min(0).max(9999).optional(),
    }).parse(req.body);
    if (body.expression) assertParses(body.expression);

    return reply.code(202).send({ data: await updateItem(ctx, id, body) });
  });

  app.delete("/v1/metadata/validation-rules/:id", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, ADMIN);
    const { id } = z.object({ id: z.string().uuid() }).parse(req.params);
    return reply.code(202).send({ data: await deleteItem(ctx, id) });
  });

  registerErrorHandler(app);
}
