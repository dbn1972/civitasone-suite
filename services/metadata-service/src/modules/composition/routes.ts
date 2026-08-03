/**
 * Module composition routes (CAP-111 low-code composition, CAP-114 configurator).
 * Writes return 202 Accepted (CQRS). Reads remain synchronous.
 */
import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { randomUUID } from "node:crypto";
import { eq, and } from "drizzle-orm";
import { resolveContext, requireRole, HttpError } from "../../shared/context.js";
import { withTenant, type Tx } from "../../shared/scope.js";
import { registerErrorHandler } from "../../shared/errors.js";
import { ADMIN } from "../../shared/roles.js";
import { entityDefinitions, layoutDefinitions, moduleCompositions } from "../entities/schema.js";
import { validateComposition, type CompositionDefinition } from "./domain.js";
import { publishCommand } from "../../shared/publish.js";
import { COMMANDS } from "../../topics.js";

const definitionSchema = z.object({
  entities: z.array(z.string().min(1).max(128)),
  layouts: z.array(z.object({ entity: z.string(), layoutId: z.string().uuid() })).optional(),
  workflows: z.array(z.string()).optional(),
  navigation: z.array(z.object({ entity: z.string(), label: z.string(), order: z.number().optional() })).optional(),
});

async function loadRefs(tx: Tx, tenantId: string): Promise<{ entityApiNames: Set<string>; layoutIds: Set<string> }> {
  const ents = await tx.select({ apiName: entityDefinitions.apiName }).from(entityDefinitions)
    .where(eq(entityDefinitions.tenantId, tenantId));
  const lays = await tx.select({ id: layoutDefinitions.id }).from(layoutDefinitions)
    .where(eq(layoutDefinitions.tenantId, tenantId));
  return { entityApiNames: new Set(ents.map((e) => e.apiName)), layoutIds: new Set(lays.map((l) => l.id)) };
}

export async function compositionRoutes(app: FastifyInstance): Promise<void> {
  app.post("/v1/metadata/compositions", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, ADMIN);
    const body = z.object({
      apiName: z.string().min(1).max(128).regex(/^[a-z][a-z0-9_]*$/),
      label: z.string().min(1).max(256),
      definition: definitionSchema,
    }).parse(req.body);

    await withTenant(ctx.tenantId, async (tx) => {
      const refs = await loadRefs(tx, ctx.tenantId);
      const result = validateComposition(body.definition as CompositionDefinition, refs);
      if (!result.valid) throw new HttpError(422, "COMPOSITION_INVALID", result.errors.join("; "));
    });

    const id = randomUUID();
    return reply.code(202).send({
      data: await publishCommand(ctx, COMMANDS.COMPOSITION_CREATE, id, {
        apiName: body.apiName, label: body.label, definition: body.definition,
      }),
    });
  });

  app.get("/v1/metadata/compositions", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, ADMIN);
    const rows = await withTenant(ctx.tenantId, (tx) =>
      tx.select().from(moduleCompositions).where(eq(moduleCompositions.tenantId, ctx.tenantId)),
    );
    return reply.send({ data: rows, meta: { total: rows.length } });
  });

  app.get("/v1/metadata/compositions/:id", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, ADMIN);
    const { id } = z.object({ id: z.string().uuid() }).parse(req.params);
    const rows = await withTenant(ctx.tenantId, (tx) =>
      tx.select().from(moduleCompositions).where(and(eq(moduleCompositions.id, id), eq(moduleCompositions.tenantId, ctx.tenantId))).limit(1),
    );
    if (!rows[0]) throw new HttpError(404, "NOT_FOUND", "Composition not found");
    return reply.send({ data: rows[0] });
  });

  app.post("/v1/metadata/compositions/:id/publish", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, ADMIN);
    const { id } = z.object({ id: z.string().uuid() }).parse(req.params);

    await withTenant(ctx.tenantId, async (tx) => {
      const existing = await tx.select().from(moduleCompositions)
        .where(and(eq(moduleCompositions.id, id), eq(moduleCompositions.tenantId, ctx.tenantId))).limit(1);
      if (!existing[0]) throw new HttpError(404, "NOT_FOUND", "Composition not found");
      if (existing[0].publishedAt) throw new HttpError(409, "ALREADY_PUBLISHED", "Composition is already published");
      if (existing[0].createdBy === ctx.actorId) {
        throw new HttpError(403, "MAKER_CANNOT_CHECK", "the composition's author cannot publish it — a different admin must approve");
      }
      const refs = await loadRefs(tx, ctx.tenantId);
      const result = validateComposition(existing[0].definition as CompositionDefinition, refs);
      if (!result.valid) throw new HttpError(422, "COMPOSITION_INVALID", result.errors.join("; "));
    });

    return reply.code(202).send({ data: await publishCommand(ctx, COMMANDS.COMPOSITION_PUBLISH, id, {}) });
  });

  registerErrorHandler(app);
}
