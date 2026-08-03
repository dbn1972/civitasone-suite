/**
 * Custom fields CRUD routes (CQRS).
 * Max 50 custom fields per entity type per tenant (Req 8.8).
 * Mutations: validate → publish → 202; writes live in consumer.ts.
 */
import type { FastifyInstance } from "fastify";
import { sendAccepted } from "@civitasone/schemas/validate";
import { acceptedResponseSchema } from "@civitasone/schemas/common";
import { resolveContext, requireRole, HttpError } from "../../shared/context.js";
import { createCustomFieldBody, updateCustomFieldBody, idParam, entityTypeParam } from "./validators.js";
import * as repo from "./repo.js";
import * as commands from "./commands.js";

const ADMIN_ROLES = ["crm_admin", "tenant_admin", "super_admin"];
const CRM_ROLES = ["crm_user", "crm_admin", "super_admin"];
const MAX_CUSTOM_FIELDS_PER_ENTITY = 50;

export async function customFieldRoutes(app: FastifyInstance): Promise<void> {
  app.get("/v1/crm/custom-fields/:entityType", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, CRM_ROLES);
    const { entityType } = entityTypeParam.parse(req.params);
    const fields = await repo.listByEntityType(ctx.tenantId, entityType, 50, 0);
    return reply.send({ data: fields, meta: { page: 1, pageSize: 50, total: fields.length } });
  });

  app.get("/v1/crm/custom-fields/definition/:id", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, CRM_ROLES);
    const { id } = idParam.parse(req.params);
    const field = await repo.findById(id, ctx.tenantId);
    if (!field) throw new HttpError(404, "NOT_FOUND", "custom field not found");
    return reply.send({ data: field });
  });

  app.post("/v1/crm/custom-fields", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, ADMIN_ROLES);
    const body = createCustomFieldBody.parse(req.body);

    const count = await repo.countByEntityType(ctx.tenantId, body.entityType);
    if (count >= MAX_CUSTOM_FIELDS_PER_ENTITY) {
      throw new HttpError(
        422,
        "CUSTOM_FIELD_LIMIT_REACHED",
        `maximum of ${MAX_CUSTOM_FIELDS_PER_ENTITY} custom fields per entity type reached`,
      );
    }

    return sendAccepted(reply, acceptedResponseSchema, await commands.createCustomField(ctx, body));
  });

  app.patch("/v1/crm/custom-fields/:id", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, ADMIN_ROLES);
    const { id } = idParam.parse(req.params);
    const body = updateCustomFieldBody.parse(req.body);

    const existing = await repo.findById(id, ctx.tenantId);
    if (!existing) throw new HttpError(404, "NOT_FOUND", "custom field not found");

    return sendAccepted(reply, acceptedResponseSchema, await commands.updateCustomField(ctx, id, body));
  });

  app.delete("/v1/crm/custom-fields/:id", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, ADMIN_ROLES);
    const { id } = idParam.parse(req.params);

    const existing = await repo.findById(id, ctx.tenantId);
    if (!existing) throw new HttpError(404, "NOT_FOUND", "custom field not found");

    return sendAccepted(reply, acceptedResponseSchema, await commands.deleteCustomField(ctx, id));
  });
}
