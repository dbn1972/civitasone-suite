/**
 * Custom-field VALUE store API (GAP-CRM-CUSTOM-FIELDS-01, owner decision C10).
 *
 *   GET /v1/crm/custom-field-values/:entityType/:entityId   — every defined field + its value
 *   PUT /v1/crm/custom-field-values/:entityType/:entityId   — { values: { <fieldId>: value | null } }
 *
 * Values live in crm.custom_field_values (one row per field per record). Writes are CQRS: the
 * route validates every value against its definition and publishes ONE command; the consumer
 * upserts in a single transaction with an audit event that carries field ids only, never values.
 *
 * Sensitive fields (sensitive:true, or a sensitive-looking name) are ENCRYPTED before they are
 * published, so neither the queue/outbox nor the table ever holds the clear value, and are
 * returned in the clear only to the roles the definition allows (visibleToRoles, default
 * crm_admin / super_admin); everyone else gets { masked: true, value: null }.
 */
import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { sql } from "drizzle-orm";
import { resolveContext, requireRole, HttpError } from "../../shared/context.js";
import { scopedRead } from "../../shared/db.js";
import { publishCrmCommand } from "../../shared/residual-publish.js";
import { encryptPii, decryptPii } from "../../shared/pii-crypto.js";
import { COMMANDS } from "../../topics.js";
import { entityTypeParam } from "./validators.js";
import * as repo from "./repo.js";
import { rulesOf, validateValue, canReadValue, type FieldDef } from "./values-domain.js";

const CRM_ROLES = ["crm_user", "crm_admin", "super_admin"];
const WRITE_ROLES = ["crm_user", "crm_admin", "super_admin"];
const MAX_FIELDS_PER_WRITE = 50;

const pathParams = z.object({ entityType: entityTypeParam.shape.entityType, entityId: z.string().uuid() });
const putBody = z.object({
  values: z.record(z.string().uuid(), z.unknown()).refine((v) => Object.keys(v).length > 0 && Object.keys(v).length <= MAX_FIELDS_PER_WRITE, {
    message: `between 1 and ${MAX_FIELDS_PER_WRITE} values per request`,
  }),
});

/** Lead and contact values both attach to a crm.contacts row. */
const ENTITY_TABLE = { leads: "crm.contacts", contacts: "crm.contacts", deals: "crm.deals" } as const;

async function entityExists(tenantId: string, entityType: keyof typeof ENTITY_TABLE, id: string): Promise<boolean> {
  const rows = (await scopedRead((tx) => tx.execute(sql`
    SELECT 1 AS ok FROM ${sql.raw(ENTITY_TABLE[entityType])} WHERE id = ${id} AND tenant_id = ${tenantId} LIMIT 1
  `))) as unknown as unknown[];
  return rows.length > 0;
}

interface StoredValue { fieldId: string; value: unknown }

async function storedValues(tenantId: string, entityType: string, entityId: string): Promise<StoredValue[]> {
  return (await scopedRead((tx) => tx.execute(sql`
    SELECT field_id AS "fieldId", value
    FROM crm.custom_field_values
    WHERE tenant_id = ${tenantId} AND entity_type = ${entityType} AND entity_id = ${entityId}
  `))) as unknown as StoredValue[];
}

export async function customFieldValueRoutes(app: FastifyInstance): Promise<void> {
  app.get("/v1/crm/custom-field-values/:entityType/:entityId", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, CRM_ROLES);
    const { entityType, entityId } = pathParams.parse(req.params);
    if (!(await entityExists(ctx.tenantId, entityType, entityId))) throw new HttpError(404, "NOT_FOUND", `${entityType.slice(0, -1)} not found`);

    const defs = await repo.listByEntityType(ctx.tenantId, entityType, 50, 0);
    const byField = new Map((await storedValues(ctx.tenantId, entityType, entityId)).map((v) => [v.fieldId, v.value]));
    const data = defs.map((d) => {
      const rules = rulesOf(d);
      const stored = byField.get(d.id);
      const hasValue = stored !== undefined && stored !== null;
      const base = { fieldId: d.id, fieldName: d.fieldName, fieldType: d.fieldType, sensitive: rules.sensitive, hasValue };
      if (!hasValue) return { ...base, value: null, masked: false };
      if (!canReadValue(rules, ctx.roles)) return { ...base, value: null, masked: true };
      const enc = (stored as { enc?: unknown }).enc;
      const value = typeof enc === "string" ? JSON.parse(decryptPii(enc)) : stored;
      return { ...base, value, masked: false };
    });
    return reply.send({ data, meta: { total: data.length } });
  });

  app.put("/v1/crm/custom-field-values/:entityType/:entityId", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, WRITE_ROLES);
    const { entityType, entityId } = pathParams.parse(req.params);
    const { values } = putBody.parse(req.body);
    if (!(await entityExists(ctx.tenantId, entityType, entityId))) throw new HttpError(404, "NOT_FOUND", `${entityType.slice(0, -1)} not found`);

    const defs = new Map<string, FieldDef>((await repo.listByEntityType(ctx.tenantId, entityType, 50, 0)).map((d) => [d.id, d]));
    const errors: Array<{ field: string; message: string }> = [];
    const sets: Array<{ fieldId: string; value: unknown }> = [];
    const clears: string[] = [];

    for (const [fieldId, raw] of Object.entries(values)) {
      const def = defs.get(fieldId);
      if (!def) {
        errors.push({ field: fieldId, message: "unknown custom field for this record type" });
        continue;
      }
      const rules = rulesOf(def);
      // A caller who cannot read a sensitive field must not be able to overwrite it blind either.
      if (rules.sensitive && !canReadValue(rules, ctx.roles)) {
        throw new HttpError(403, "FORBIDDEN", `custom field "${def.fieldName}" is sensitive and not writable by your role`);
      }
      if (raw === null) {
        if (rules.required) errors.push({ field: fieldId, message: `${def.fieldName}: is required and cannot be cleared` });
        else clears.push(fieldId);
        continue;
      }
      const res = validateValue(def, raw);
      if (!res.ok) {
        errors.push({ field: fieldId, message: res.error });
        continue;
      }
      sets.push({ fieldId, value: rules.sensitive ? { enc: encryptPii(JSON.stringify(res.value)) } : res.value });
    }
    if (errors.length > 0) {
      throw new HttpError(400, "VALIDATION_FAILED", errors.map((e) => e.message).join("; "));
    }

    const accepted = await publishCrmCommand(ctx, COMMANDS.setCustomFieldValues, `${entityType}:${entityId}`, {
      entityType, entityId, sets, clears,
    });
    return reply.code(202).send(accepted);
  });
}
