/**
 * Form / layout builder routes (CAP-109).
 *
 *   GET   /v1/metadata/entities/:entityId/layouts — list layouts
 *   POST  /v1/metadata/entities/:entityId/layouts — create a layout (form definition)
 *   PATCH /v1/metadata/layouts/:id                — update a layout
 *
 * A layout is a set of sections, each referencing field apiNames. Referenced
 * fields are checked against the entity's actual fields inside the same
 * tenant-scoped transaction, so a form can never point at a non-existent field.
 */
import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { eq, and } from "drizzle-orm";
import { resolveContext, requireRole, HttpError } from "../../shared/context.js";
import { withTenant } from "../../shared/scope.js";
import { registerErrorHandler } from "../../shared/errors.js";
import { ADMIN } from "../../shared/roles.js";
import { entityDefinitions, fieldDefinitions, layoutDefinitions } from "../entities/schema.js";

const sectionSchema = z.object({
  label: z.string().min(1).max(256),
  columns: z.number().int().min(1).max(4).default(1),
  fields: z.array(z.string().min(1).max(128)),
});

const createLayoutSchema = z.object({
  layoutType: z.enum(["detail", "list", "create", "edit"]).default("detail"),
  sections: z.array(sectionSchema).min(1),
  isDefault: z.boolean().default(false),
});

export async function layoutRoutes(app: FastifyInstance): Promise<void> {
  app.get("/v1/metadata/entities/:entityId/layouts", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, ADMIN);
    const { entityId } = z.object({ entityId: z.string().uuid() }).parse(req.params);
    const rows = await withTenant(ctx.tenantId, (tx) =>
      tx.select().from(layoutDefinitions)
        .where(and(eq(layoutDefinitions.entityDefId, entityId), eq(layoutDefinitions.tenantId, ctx.tenantId))),
    );
    return reply.send({ data: rows, meta: { total: rows.length } });
  });

  app.post("/v1/metadata/entities/:entityId/layouts", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, ADMIN);
    const { entityId } = z.object({ entityId: z.string().uuid() }).parse(req.params);
    const body = createLayoutSchema.parse(req.body);

    const row = await withTenant(ctx.tenantId, async (tx) => {
      const parent = await tx.select().from(entityDefinitions)
        .where(and(eq(entityDefinitions.id, entityId), eq(entityDefinitions.tenantId, ctx.tenantId))).limit(1);
      if (!parent[0]) throw new HttpError(404, "NOT_FOUND", "Entity definition not found");

      const fields = await tx.select({ apiName: fieldDefinitions.apiName }).from(fieldDefinitions)
        .where(and(eq(fieldDefinitions.entityDefId, entityId), eq(fieldDefinitions.tenantId, ctx.tenantId)));
      const known = new Set(fields.map((f) => f.apiName));
      const missing = body.sections.flatMap((s) => s.fields).filter((f) => !known.has(f));
      if (missing.length) throw new HttpError(422, "UNKNOWN_FIELDS", `layout references unknown fields: ${[...new Set(missing)].join(", ")}`);

      const [created] = await tx.insert(layoutDefinitions).values({
        tenantId: ctx.tenantId,
        entityDefId: entityId,
        layoutType: body.layoutType,
        sections: body.sections,
        isDefault: body.isDefault,
        createdBy: ctx.actorId,
        updatedBy: ctx.actorId,
      }).returning();
      return created;
    });
    return reply.code(201).send({ data: row });
  });

  app.patch("/v1/metadata/layouts/:id", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, ADMIN);
    const { id } = z.object({ id: z.string().uuid() }).parse(req.params);
    const body = z.object({
      sections: z.array(sectionSchema).min(1).optional(),
      isDefault: z.boolean().optional(),
    }).parse(req.body);

    const row = await withTenant(ctx.tenantId, async (tx) => {
      const existing = await tx.select().from(layoutDefinitions)
        .where(and(eq(layoutDefinitions.id, id), eq(layoutDefinitions.tenantId, ctx.tenantId))).limit(1);
      if (!existing[0]) throw new HttpError(404, "NOT_FOUND", "Layout not found");

      if (body.sections) {
        const fields = await tx.select({ apiName: fieldDefinitions.apiName }).from(fieldDefinitions)
          .where(and(eq(fieldDefinitions.entityDefId, existing[0].entityDefId), eq(fieldDefinitions.tenantId, ctx.tenantId)));
        const known = new Set(fields.map((f) => f.apiName));
        const missing = body.sections.flatMap((s) => s.fields).filter((f) => !known.has(f));
        if (missing.length) throw new HttpError(422, "UNKNOWN_FIELDS", `layout references unknown fields: ${[...new Set(missing)].join(", ")}`);
      }

      const set: Record<string, unknown> = { updatedAt: new Date(), updatedBy: ctx.actorId };
      if (body.sections !== undefined) set.sections = body.sections;
      if (body.isDefault !== undefined) set.isDefault = body.isDefault;
      const [updated] = await tx.update(layoutDefinitions).set(set)
        .where(and(eq(layoutDefinitions.id, id), eq(layoutDefinitions.tenantId, ctx.tenantId))).returning();
      return updated;
    });
    return reply.send({ data: row });
  });

  registerErrorHandler(app);
}
