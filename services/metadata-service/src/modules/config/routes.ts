import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { eq } from "drizzle-orm";
import { randomUUID } from "node:crypto";
import { resolveContext, requireRole, HttpError } from "../../shared/context.js";
import { withTenant } from "../../shared/scope.js";
import { publishCommand } from "../../shared/publish.js";
import { COMMANDS } from "../../topics.js";
import {
  entityDefinitions,
  fieldDefinitions,
  layoutDefinitions,
  validationRules,
  formulaDefinitions,
  moduleCompositions,
} from "../entities/schema.js";
import { numberFormats } from "../numbering/schema.js";

const ADMIN = ["super_admin", "platform_admin", "metadata_admin"];

const CONFIG_VERSION = "1.0";

export async function configRoutes(app: FastifyInstance): Promise<void> {
  app.get("/v1/metadata/config/export", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, ADMIN);

    const tid = ctx.tenantId;
    const [entities, fields, layouts, rules, formulas, compositions, formats] =
      await Promise.all([
        withTenant(tid, (tx) =>
          tx.select().from(entityDefinitions).where(eq(entityDefinitions.tenantId, tid)),
        ),
        withTenant(tid, (tx) =>
          tx.select().from(fieldDefinitions).where(eq(fieldDefinitions.tenantId, tid)),
        ),
        withTenant(tid, (tx) =>
          tx.select().from(layoutDefinitions).where(eq(layoutDefinitions.tenantId, tid)),
        ),
        withTenant(tid, (tx) =>
          tx.select().from(validationRules).where(eq(validationRules.tenantId, tid)),
        ),
        withTenant(tid, (tx) =>
          tx.select().from(formulaDefinitions).where(eq(formulaDefinitions.tenantId, tid)),
        ),
        withTenant(tid, (tx) =>
          tx.select().from(moduleCompositions).where(eq(moduleCompositions.tenantId, tid)),
        ),
        withTenant(tid, (tx) =>
          tx.select().from(numberFormats).where(eq(numberFormats.tenantId, tid)),
        ),
      ]);

    return reply.send({
      data: {
        version: CONFIG_VERSION,
        exportedAt: new Date().toISOString(),
        tenantId: tid,
        entities,
        fields,
        layouts,
        validationRules: rules,
        formulas,
        compositions,
        numberFormats: formats,
      },
    });
  });

  const importBody = z.object({
    version: z.string(),
    entities: z.array(z.record(z.unknown())).optional().default([]),
    fields: z.array(z.record(z.unknown())).optional().default([]),
    layouts: z.array(z.record(z.unknown())).optional().default([]),
    validationRules: z.array(z.record(z.unknown())).optional().default([]),
    formulas: z.array(z.record(z.unknown())).optional().default([]),
    compositions: z.array(z.record(z.unknown())).optional().default([]),
    numberFormats: z.array(z.record(z.unknown())).optional().default([]),
  });

  app.post("/v1/metadata/config/import", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, ADMIN);

    const body = importBody.parse(req.body);
    const batchId = randomUUID();

    const commands: Array<{ type: string; payload: Record<string, unknown> }> = [];

    for (const entity of body.entities) {
      commands.push({ type: COMMANDS.ENTITY_CREATE, payload: entity });
    }
    for (const field of body.fields) {
      commands.push({ type: COMMANDS.FIELD_CREATE, payload: field });
    }
    for (const layout of body.layouts) {
      commands.push({ type: COMMANDS.LAYOUT_CREATE, payload: layout });
    }
    for (const rule of body.validationRules) {
      commands.push({ type: COMMANDS.RULE_CREATE, payload: rule });
    }
    for (const formula of body.formulas) {
      commands.push({ type: COMMANDS.FORMULA_CREATE, payload: formula });
    }
    for (const composition of body.compositions) {
      commands.push({ type: COMMANDS.COMPOSITION_CREATE, payload: composition });
    }
    for (const format of body.numberFormats) {
      commands.push({ type: COMMANDS.NUMBER_FORMAT_CREATE, payload: format });
    }

    for (const cmd of commands) {
      const id = (cmd.payload as { id?: string }).id ?? randomUUID();
      await publishCommand(ctx, cmd.type, id, { ...cmd.payload, importBatchId: batchId });
    }

    return reply.code(202).send({
      data: {
        batchId,
        commandsPublished: commands.length,
        status: "accepted",
      },
    });
  });
}
