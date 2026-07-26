/**
 * Formula / calculation engine routes (CAP-113).
 *
 *   POST /v1/metadata/formula/evaluate    — evaluate an ad-hoc expression (no persistence)
 *   POST /v1/metadata/formula             — persist a named formula (maker)
 *   GET  /v1/metadata/formula             — list named formulas
 *   GET  /v1/metadata/formula/:id         — get a named formula
 *   POST /v1/metadata/formula/:id/evaluate — evaluate a stored formula against a context
 */
import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { eq, and } from "drizzle-orm";
import { resolveContext, requireRole, HttpError } from "../../shared/context.js";
import { withTenant } from "../../shared/scope.js";
import { registerErrorHandler } from "../../shared/errors.js";
import { ADMIN, DATA } from "../../shared/roles.js";
import { formulaDefinitions } from "../entities/schema.js";
import { evaluateFormula, validateFormula, FormulaError } from "./domain.js";

const contextSchema = z.record(z.union([z.string(), z.number(), z.boolean(), z.null()])).optional();

export async function formulaRoutes(app: FastifyInstance): Promise<void> {
  // Ad-hoc, side-effect-free evaluation.
  app.post("/v1/metadata/formula/evaluate", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, DATA);
    const body = z.object({ expression: z.string().min(1).max(2000), context: contextSchema }).parse(req.body);
    try {
      const result = evaluateFormula(body.expression, body.context ?? {});
      return reply.send({ data: { result } });
    } catch (err) {
      if (err instanceof FormulaError) throw new HttpError(400, "FORMULA_ERROR", err.message);
      throw err;
    }
  });

  // Persist a named formula (validated at write time).
  app.post("/v1/metadata/formula", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, ADMIN);
    const body = z.object({
      apiName: z.string().min(1).max(128).regex(/^[a-z][a-z0-9_]*$/),
      label: z.string().min(1).max(256),
      expression: z.string().min(1).max(2000),
      returnType: z.enum(["number", "string", "boolean"]).default("number"),
      description: z.string().max(2000).optional(),
    }).parse(req.body);

    const check = validateFormula(body.expression);
    if (!check.valid) throw new HttpError(400, "FORMULA_ERROR", check.error ?? "invalid formula");

    const row = await withTenant(ctx.tenantId, async (tx) => {
      const [created] = await tx.insert(formulaDefinitions).values({
        tenantId: ctx.tenantId,
        apiName: body.apiName,
        label: body.label,
        expression: body.expression,
        returnType: body.returnType,
        description: body.description ?? null,
        createdBy: ctx.actorId,
        updatedBy: ctx.actorId,
      }).returning();
      return created;
    });
    return reply.code(201).send({ data: row });
  });

  app.get("/v1/metadata/formula", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, DATA);
    const rows = await withTenant(ctx.tenantId, (tx) =>
      tx.select().from(formulaDefinitions).where(eq(formulaDefinitions.tenantId, ctx.tenantId)),
    );
    return reply.send({ data: rows, meta: { total: rows.length } });
  });

  app.get("/v1/metadata/formula/:id", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, DATA);
    const { id } = z.object({ id: z.string().uuid() }).parse(req.params);
    const rows = await withTenant(ctx.tenantId, (tx) =>
      tx.select().from(formulaDefinitions).where(and(eq(formulaDefinitions.id, id), eq(formulaDefinitions.tenantId, ctx.tenantId))).limit(1),
    );
    if (!rows[0]) throw new HttpError(404, "NOT_FOUND", "Formula not found");
    return reply.send({ data: rows[0] });
  });

  // Evaluate a stored formula against a supplied context.
  app.post("/v1/metadata/formula/:id/evaluate", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, DATA);
    const { id } = z.object({ id: z.string().uuid() }).parse(req.params);
    const body = z.object({ context: contextSchema }).parse(req.body ?? {});
    const rows = await withTenant(ctx.tenantId, (tx) =>
      tx.select().from(formulaDefinitions).where(and(eq(formulaDefinitions.id, id), eq(formulaDefinitions.tenantId, ctx.tenantId))).limit(1),
    );
    if (!rows[0]) throw new HttpError(404, "NOT_FOUND", "Formula not found");
    try {
      const result = evaluateFormula(rows[0].expression, body.context ?? {});
      return reply.send({ data: { id, result } });
    } catch (err) {
      if (err instanceof FormulaError) throw new HttpError(400, "FORMULA_ERROR", err.message);
      throw err;
    }
  });

  registerErrorHandler(app);
}
