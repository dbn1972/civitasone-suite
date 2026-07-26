/**
 * Generic master-data / custom-records CRUD (CAP-016 master-data admin, CAP-116 store).
 *
 *   GET    /v1/metadata/entities/:entityId/records — list master records
 *   POST   /v1/metadata/entities/:entityId/records — create a record
 *   GET    /v1/metadata/records/:id                — get a record
 *   PATCH  /v1/metadata/records/:id                — update a record (merge)
 *   DELETE /v1/metadata/records/:id                — delete a record
 *
 * On write, the record's `data` is validated against the entity's field
 * definitions and active validation rules (see modules/rules/domain.ts) inside
 * the same tenant-scoped transaction. Invalid records are rejected 422 and
 * never persisted.
 */
import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { eq, and, desc } from "drizzle-orm";
import { resolveContext, requireRole, HttpError } from "../../shared/context.js";
import { withTenant, type Tx } from "../../shared/scope.js";
import { registerErrorHandler } from "../../shared/errors.js";
import { DATA } from "../../shared/roles.js";
import { entityDefinitions, fieldDefinitions, validationRules, customRecords } from "../entities/schema.js";
import { validateRecord, type FieldDef, type ValidationRule } from "../rules/domain.js";

async function loadDefs(tx: Tx, tenantId: string, entityId: string): Promise<{ fields: FieldDef[]; rules: ValidationRule[] }> {
  const fieldRows = await tx.select().from(fieldDefinitions)
    .where(and(eq(fieldDefinitions.entityDefId, entityId), eq(fieldDefinitions.tenantId, tenantId)));
  const ruleRows = await tx.select().from(validationRules)
    .where(and(eq(validationRules.entityDefId, entityId), eq(validationRules.tenantId, tenantId)));
  const fields: FieldDef[] = fieldRows.filter((f) => f.isActive).map((f) => ({
    apiName: f.apiName,
    fieldType: f.fieldType,
    isRequired: f.isRequired,
    label: f.label,
    ...(Array.isArray(f.picklistValues) ? { picklistValues: f.picklistValues as string[] } : {}),
  }));
  const rules: ValidationRule[] = ruleRows.map((r) => ({
    name: r.name,
    expression: r.expression,
    errorMessage: r.errorMessage,
    isActive: r.isActive,
  }));
  return { fields, rules };
}

export async function recordRoutes(app: FastifyInstance): Promise<void> {
  app.get("/v1/metadata/entities/:entityId/records", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, DATA);
    const { entityId } = z.object({ entityId: z.string().uuid() }).parse(req.params);
    const rows = await withTenant(ctx.tenantId, (tx) =>
      tx.select().from(customRecords)
        .where(and(eq(customRecords.entityDefId, entityId), eq(customRecords.tenantId, ctx.tenantId)))
        .orderBy(desc(customRecords.createdAt)),
    );
    return reply.send({ data: rows, meta: { total: rows.length } });
  });

  app.post("/v1/metadata/entities/:entityId/records", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, DATA);
    const { entityId } = z.object({ entityId: z.string().uuid() }).parse(req.params);
    const body = z.object({ data: z.record(z.unknown()) }).parse(req.body);

    const row = await withTenant(ctx.tenantId, async (tx) => {
      const parent = await tx.select().from(entityDefinitions)
        .where(and(eq(entityDefinitions.id, entityId), eq(entityDefinitions.tenantId, ctx.tenantId))).limit(1);
      if (!parent[0]) throw new HttpError(404, "NOT_FOUND", "Entity definition not found");

      const { fields, rules } = await loadDefs(tx, ctx.tenantId, entityId);
      const errors = validateRecord(body.data, fields, rules);
      if (errors.length) throw new HttpError(422, "RECORD_INVALID", errors.join("; "));

      const [created] = await tx.insert(customRecords).values({
        tenantId: ctx.tenantId,
        entityDefId: entityId,
        data: body.data,
        createdBy: ctx.actorId,
        updatedBy: ctx.actorId,
      }).returning();
      return created;
    });
    return reply.code(201).send({ data: row });
  });

  app.get("/v1/metadata/records/:id", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, DATA);
    const { id } = z.object({ id: z.string().uuid() }).parse(req.params);
    const rows = await withTenant(ctx.tenantId, (tx) =>
      tx.select().from(customRecords).where(and(eq(customRecords.id, id), eq(customRecords.tenantId, ctx.tenantId))).limit(1),
    );
    if (!rows[0]) throw new HttpError(404, "NOT_FOUND", "Record not found");
    return reply.send({ data: rows[0] });
  });

  app.patch("/v1/metadata/records/:id", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, DATA);
    const { id } = z.object({ id: z.string().uuid() }).parse(req.params);
    const body = z.object({ data: z.record(z.unknown()) }).parse(req.body);

    const row = await withTenant(ctx.tenantId, async (tx) => {
      const existing = await tx.select().from(customRecords)
        .where(and(eq(customRecords.id, id), eq(customRecords.tenantId, ctx.tenantId))).limit(1);
      if (!existing[0]) throw new HttpError(404, "NOT_FOUND", "Record not found");

      const merged = { ...(existing[0].data as Record<string, unknown>), ...body.data };
      const { fields, rules } = await loadDefs(tx, ctx.tenantId, existing[0].entityDefId);
      const errors = validateRecord(merged, fields, rules);
      if (errors.length) throw new HttpError(422, "RECORD_INVALID", errors.join("; "));

      const [updated] = await tx.update(customRecords)
        .set({ data: merged, updatedAt: new Date(), updatedBy: ctx.actorId, version: existing[0].version + 1 })
        .where(and(eq(customRecords.id, id), eq(customRecords.tenantId, ctx.tenantId))).returning();
      return updated;
    });
    return reply.send({ data: row });
  });

  app.delete("/v1/metadata/records/:id", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, DATA);
    const { id } = z.object({ id: z.string().uuid() }).parse(req.params);
    const deleted = await withTenant(ctx.tenantId, async (tx) => {
      const [d] = await tx.delete(customRecords)
        .where(and(eq(customRecords.id, id), eq(customRecords.tenantId, ctx.tenantId))).returning({ id: customRecords.id });
      return d;
    });
    if (!deleted) throw new HttpError(404, "NOT_FOUND", "Record not found");
    return reply.send({ data: { id, deleted: true } });
  });

  registerErrorHandler(app);
}
