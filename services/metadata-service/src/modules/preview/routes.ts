/**
 * Config preview / dry-run route (CAP-117).
 *
 *   POST /v1/metadata/config/preview — validate a proposed config change and show
 *   its effect against sample records WITHOUT persisting anything.
 *
 * The endpoint loads existing artifact names (for collision detection) inside a
 * read-only tenant-scoped transaction, then runs the pure preview engine. No
 * write is ever issued.
 */
import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { eq, and } from "drizzle-orm";
import { resolveContext, requireRole } from "../../shared/context.js";
import { withTenant } from "../../shared/scope.js";
import { registerErrorHandler } from "../../shared/errors.js";
import { ADMIN } from "../../shared/roles.js";
import { entityDefinitions, fieldDefinitions } from "../entities/schema.js";
import { previewConfigChange, type ConfigPreviewInput } from "./domain.js";

const recordArr = z.array(z.record(z.unknown())).optional();

const fieldPreview = z.object({
  kind: z.literal("field"),
  entityId: z.string().uuid().optional(),
  field: z.object({
    apiName: z.string(),
    label: z.string().optional(),
    fieldType: z.string(),
    isRequired: z.boolean().optional(),
    picklistValues: z.array(z.string()).optional(),
  }),
  sampleRecords: recordArr,
});
const rulePreview = z.object({
  kind: z.literal("validationRule"),
  rule: z.object({ name: z.string(), expression: z.string(), errorMessage: z.string() }),
  sampleRecords: recordArr,
});
const formulaPreview = z.object({
  kind: z.literal("formula"),
  expression: z.string(),
  sampleRecords: recordArr,
});
const entityPreview = z.object({
  kind: z.literal("entity"),
  entity: z.object({ apiName: z.string(), label: z.string().optional() }),
});

const previewSchema = z.discriminatedUnion("kind", [fieldPreview, rulePreview, formulaPreview, entityPreview]);

export async function previewRoutes(app: FastifyInstance): Promise<void> {
  app.post("/v1/metadata/config/preview", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, ADMIN);
    const body = previewSchema.parse(req.body);

    let input: ConfigPreviewInput;
    if (body.kind === "field") {
      let existingFieldApiNames: string[] = [];
      if (body.entityId) {
        const eid = body.entityId;
        const rows = await withTenant(ctx.tenantId, (tx) =>
          tx.select({ apiName: fieldDefinitions.apiName }).from(fieldDefinitions)
            .where(and(eq(fieldDefinitions.entityDefId, eid), eq(fieldDefinitions.tenantId, ctx.tenantId))),
        );
        existingFieldApiNames = rows.map((r) => r.apiName);
      }
      const field = {
        apiName: body.field.apiName,
        fieldType: body.field.fieldType,
        ...(body.field.label !== undefined ? { label: body.field.label } : {}),
        ...(body.field.isRequired !== undefined ? { isRequired: body.field.isRequired } : {}),
        ...(body.field.picklistValues !== undefined ? { picklistValues: body.field.picklistValues } : {}),
      };
      input = { kind: "field", field, existingFieldApiNames, ...(body.sampleRecords ? { sampleRecords: body.sampleRecords } : {}) };
    } else if (body.kind === "entity") {
      const rows = await withTenant(ctx.tenantId, (tx) =>
        tx.select({ apiName: entityDefinitions.apiName }).from(entityDefinitions).where(eq(entityDefinitions.tenantId, ctx.tenantId)),
      );
      const entity = { apiName: body.entity.apiName, ...(body.entity.label !== undefined ? { label: body.entity.label } : {}) };
      input = { kind: "entity", entity, existingEntityApiNames: rows.map((r) => r.apiName) };
    } else if (body.kind === "validationRule") {
      input = { kind: "validationRule", rule: body.rule, ...(body.sampleRecords ? { sampleRecords: body.sampleRecords } : {}) };
    } else {
      input = { kind: "formula", expression: body.expression, ...(body.sampleRecords ? { sampleRecords: body.sampleRecords } : {}) };
    }

    return reply.send({ data: previewConfigChange(input) });
  });

  registerErrorHandler(app);
}
