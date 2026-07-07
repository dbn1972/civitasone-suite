/**
 * Custom fields CRUD routes.
 * Max 50 custom fields per entity type per tenant (Req 8.8).
 */
import type { FastifyInstance } from "fastify";
import { resolveContext, requireRole, HttpError } from "../../shared/context.js";
import { createCustomFieldBody, updateCustomFieldBody, idParam, entityTypeParam } from "./validators.js";
import * as repo from "./repo.js";
import { db } from "../../shared/db.js";
import { cache } from "../../shared/infra.js";

const ADMIN_ROLES = ["crm_admin", "tenant_admin", "super_admin"];
const CRM_ROLES = ["crm_user", "crm_admin", "super_admin"];
const MAX_CUSTOM_FIELDS_PER_ENTITY = 50;
const RESOURCE = "custom_field";

export async function customFieldRoutes(app: FastifyInstance): Promise<void> {
  /**
   * List custom fields for an entity type.
   */
  app.get("/v1/crm/custom-fields/:entityType", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, CRM_ROLES);
    const { entityType } = entityTypeParam.parse(req.params);
    const fields = await repo.listByEntityType(ctx.tenantId, entityType, 50, 0);
    return reply.send({ data: fields, meta: { page: 1, pageSize: 50, total: fields.length } });
  });

  /**
   * Get a single custom field definition.
   */
  app.get("/v1/crm/custom-fields/definition/:id", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, CRM_ROLES);
    const { id } = idParam.parse(req.params);
    const field = await repo.findById(id, ctx.tenantId);
    if (!field) throw new HttpError(404, "NOT_FOUND", "custom field not found");
    return reply.send({ data: field });
  });

  /**
   * Create a custom field definition.
   * Enforces max 50 fields per entity type per tenant.
   */
  app.post("/v1/crm/custom-fields", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, ADMIN_ROLES);
    const body = createCustomFieldBody.parse(req.body);

    // Enforce limit: max 50 custom fields per entity type per tenant
    const count = await repo.countByEntityType(ctx.tenantId, body.entityType);
    if (count >= MAX_CUSTOM_FIELDS_PER_ENTITY) {
      throw new HttpError(
        422,
        "CUSTOM_FIELD_LIMIT_REACHED",
        `maximum of ${MAX_CUSTOM_FIELDS_PER_ENTITY} custom fields per entity type reached`,
      );
    }

    await repo.insert(db, {
      tenantId: ctx.tenantId,
      entityType: body.entityType,
      fieldName: body.fieldName,
      fieldType: body.fieldType,
      validationSchema: body.validationSchema ?? null,
      ordinal: body.ordinal,
      createdBy: ctx.actorId,
      updatedBy: ctx.actorId,
    });

    await cache.invalidateResource(ctx.tenantId, RESOURCE);
    return reply.code(201).send({ data: { message: "custom field created" } });
  });

  /**
   * Update a custom field definition.
   */
  app.patch("/v1/crm/custom-fields/:id", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, ADMIN_ROLES);
    const { id } = idParam.parse(req.params);
    const body = updateCustomFieldBody.parse(req.body);

    const existing = await repo.findById(id, ctx.tenantId);
    if (!existing) throw new HttpError(404, "NOT_FOUND", "custom field not found");

    await repo.update(db, id, ctx.tenantId, body, ctx.actorId);
    await cache.invalidateResource(ctx.tenantId, RESOURCE);
    return reply.code(200).send({ data: { message: "custom field updated" } });
  });

  /**
   * Delete a custom field definition.
   */
  app.delete("/v1/crm/custom-fields/:id", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, ADMIN_ROLES);
    const { id } = idParam.parse(req.params);

    const existing = await repo.findById(id, ctx.tenantId);
    if (!existing) throw new HttpError(404, "NOT_FOUND", "custom field not found");

    await repo.remove(db, id, ctx.tenantId);
    await cache.invalidateResource(ctx.tenantId, RESOURCE);
    return reply.code(204).send();
  });
}
