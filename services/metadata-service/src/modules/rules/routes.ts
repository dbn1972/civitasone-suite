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
import { evaluateExpression } from "./domain.js";

function assertParses(expression: string): void {
  try {
    evaluateExpression(expression, {});
  } catch (err) {
    throw new HttpError(400, "RULE_EXPRESSION_INVALID", err instanceof Error ? err.message : "invalid expression");
  }
}

export async function validationRuleRoutes(app: FastifyInstance): Promise<void> {
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

    const row = await withTenant(ctx.tenantId, async (tx) => {
      const parent = await tx.select().from(entityDefinitions)
        .where(and(eq(entityDefinitions.id, entityId), eq(entityDefinitions.tenantId, ctx.tenantId))).limit(1);
      if (!parent[0]) throw new HttpError(404, "NOT_FOUND", "Entity definition not found");
      const [created] = await tx.insert(validationRules).values({
        tenantId: ctx.tenantId,
        entityDefId: entityId,
        name: body.name,
        expression: body.expression,
        errorMessage: body.errorMessage,
        sortOrder: body.sortOrder,
        createdBy: ctx.actorId,
        updatedBy: ctx.actorId,
      }).returning();
      return created;
    });
    return reply.code(201).send({ data: row });
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

    const row = await withTenant(ctx.tenantId, async (tx) => {
      const set: Record<string, unknown> = { updatedAt: new Date(), updatedBy: ctx.actorId };
      for (const k of ["name", "expression", "errorMessage", "isActive", "sortOrder"] as const) {
        if (body[k] !== undefined) set[k] = body[k];
      }
      const [updated] = await tx.update(validationRules).set(set)
        .where(and(eq(validationRules.id, id), eq(validationRules.tenantId, ctx.tenantId))).returning();
      return updated;
    });
    if (!row) throw new HttpError(404, "NOT_FOUND", "Validation rule not found");
    return reply.send({ data: row });
  });

  app.delete("/v1/metadata/validation-rules/:id", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, ADMIN);
    const { id } = z.object({ id: z.string().uuid() }).parse(req.params);
    const row = await withTenant(ctx.tenantId, async (tx) => {
      const [updated] = await tx.update(validationRules)
        .set({ isActive: false, updatedAt: new Date(), updatedBy: ctx.actorId })
        .where(and(eq(validationRules.id, id), eq(validationRules.tenantId, ctx.tenantId))).returning();
      return updated;
    });
    if (!row) throw new HttpError(404, "NOT_FOUND", "Validation rule not found");
    return reply.send({ data: { id, isActive: false } });
  });

  registerErrorHandler(app);
}
