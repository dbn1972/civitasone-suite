/**
 * Custom-field / controlled schema-extension routes (CAP-116, supports CAP-109/112).
 *
 *   GET    /v1/metadata/entities/:entityId/fields  — list fields on an entity
 *   POST   /v1/metadata/entities/:entityId/fields  — define a custom field
 *   PATCH  /v1/metadata/fields/:id                 — update a custom field
 *   DELETE /v1/metadata/fields/:id                 — deactivate a custom field
 *
 * Every field belongs to an entity_definition; the parent is verified inside the
 * same tenant-scoped transaction so a field can never attach to another tenant's
 * entity.
 */
import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { eq, and, asc } from "drizzle-orm";
import { resolveContext, requireRole, HttpError } from "../../shared/context.js";
import { withTenant } from "../../shared/scope.js";
import { registerErrorHandler } from "../../shared/errors.js";
import { ADMIN } from "../../shared/roles.js";
import { entityDefinitions, fieldDefinitions } from "../entities/schema.js";
import { createItem, updateItem, deleteItem } from "./commands.js";

const FIELD_TYPES = ["text", "number", "currency", "date", "boolean", "picklist", "lookup", "formula"] as const;

const createFieldSchema = z.object({
  apiName: z.string().min(1).max(128).regex(/^[a-z][a-z0-9_]*$/),
  label: z.string().min(1).max(256),
  fieldType: z.enum(FIELD_TYPES),
  isRequired: z.boolean().default(false),
  isUnique: z.boolean().default(false),
  defaultValue: z.unknown().optional(),
  picklistValues: z.array(z.string().min(1).max(256)).optional(),
  lookupEntityId: z.string().uuid().optional(),
  formulaExpression: z.string().max(2000).optional(),
  sortOrder: z.number().int().min(0).max(9999).default(0),
}).superRefine((v, c) => {
  if (v.fieldType === "picklist" && (!v.picklistValues || v.picklistValues.length === 0)) {
    c.addIssue({ code: z.ZodIssueCode.custom, message: "picklist requires picklistValues", path: ["picklistValues"] });
  }
  if (v.fieldType === "lookup" && !v.lookupEntityId) {
    c.addIssue({ code: z.ZodIssueCode.custom, message: "lookup requires lookupEntityId", path: ["lookupEntityId"] });
  }
});

export async function fieldRoutes(app: FastifyInstance): Promise<void> {
  app.get("/v1/metadata/entities/:entityId/fields", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, ADMIN);
    const { entityId } = z.object({ entityId: z.string().uuid() }).parse(req.params);
    const rows = await withTenant(ctx.tenantId, (tx) =>
      tx.select().from(fieldDefinitions)
        .where(and(eq(fieldDefinitions.entityDefId, entityId), eq(fieldDefinitions.tenantId, ctx.tenantId)))
        .orderBy(asc(fieldDefinitions.sortOrder)),
    );
    return reply.send({ data: rows, meta: { total: rows.length } });
  });

  app.post("/v1/metadata/entities/:entityId/fields", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, ADMIN);
    const { entityId } = z.object({ entityId: z.string().uuid() }).parse(req.params);
    const body = createFieldSchema.parse(req.body);

    const parent = await withTenant(ctx.tenantId, (tx) =>
      tx.select().from(entityDefinitions)
        .where(and(eq(entityDefinitions.id, entityId), eq(entityDefinitions.tenantId, ctx.tenantId))).limit(1));
    if (!parent[0]) throw new HttpError(404, "NOT_FOUND", "Entity definition not found");
    return reply.code(202).send({ data: await createItem(ctx, { ...body, entityId }) });
  });

  app.patch("/v1/metadata/fields/:id", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, ADMIN);
    const { id } = z.object({ id: z.string().uuid() }).parse(req.params);
    const body = z.object({
      label: z.string().min(1).max(256).optional(),
      isRequired: z.boolean().optional(),
      isUnique: z.boolean().optional(),
      picklistValues: z.array(z.string().min(1).max(256)).optional(),
      sortOrder: z.number().int().min(0).max(9999).optional(),
      isActive: z.boolean().optional(),
    }).parse(req.body);

    return reply.code(202).send({ data: await updateItem(ctx, id, body) });
  });

  app.delete("/v1/metadata/fields/:id", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, ADMIN);
    const { id } = z.object({ id: z.string().uuid() }).parse(req.params);
    return reply.code(202).send({ data: await deleteItem(ctx, id) });
  });

  registerErrorHandler(app);
}
