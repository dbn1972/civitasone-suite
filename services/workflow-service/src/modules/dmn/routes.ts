/**
 * DMN Decision Table — CRUD + execution routes.
 *
 * Routes:
 *   POST   /v1/workflow/dmn/tables             — create decision table → 201
 *   GET    /v1/workflow/dmn/tables             — list decision tables
 *   GET    /v1/workflow/dmn/tables/:id         — get single
 *   PATCH  /v1/workflow/dmn/tables/:id         — update (optimistic locking)
 *   DELETE /v1/workflow/dmn/tables/:id         — soft-delete
 *   POST   /v1/workflow/dmn/tables/:id/execute — evaluate with input payload
 */
import type { FastifyInstance } from "fastify";
import { z, ZodError } from "zod";
import { eq, and, desc } from "drizzle-orm";
import { resolveContext, requireRole, HttpError } from "../../shared/context.js";
import { scopedRead } from "../../shared/db.js";
import { acceptedResponseSchema } from "@civitasone/schemas/common";
import { sendAccepted } from "@civitasone/schemas/validate";
import { dmnTables, type DmnInput, type DmnOutput, type DmnRule, type DmnHitPolicy } from "./schema.js";
import { evaluateDecisionTable, type DmnTableDef } from "./domain.js";
import * as commands from "./commands.js";

const ROLES = ["workflow_user", "workflow_admin", "super_admin", "tenant_admin"];
const ADMIN_ROLES = ["workflow_admin", "super_admin", "tenant_admin"];

/** Maximum constraints per the DMN spec in this system. */
const MAX_INPUTS = 30;
const MAX_OUTPUTS = 30;
const MAX_RULES = 500;

// ── Zod Schemas ───────────────────────────────────────────────────

const dmnInputSchema = z.object({
  key: z.string().min(1).max(64),
  label: z.string().min(1).max(200),
  type: z.enum(["string", "number", "boolean"]),
});

const dmnOutputSchema = z.object({
  key: z.string().min(1).max(64),
  label: z.string().min(1).max(200),
  type: z.enum(["string", "number", "boolean"]),
  defaultValue: z.unknown().optional(),
});

const dmnRuleSchema = z.object({
  inputs: z.record(z.string()),
  outputs: z.record(z.unknown()),
});

const hitPolicySchema = z.enum(["UNIQUE", "FIRST", "COLLECT", "RULE_ORDER"]);

const createBodySchema = z.object({
  name: z.string().min(1).max(200),
  description: z.string().max(2000).optional(),
  hitPolicy: hitPolicySchema.default("FIRST"),
  inputs: z.array(dmnInputSchema).max(MAX_INPUTS).default([]),
  outputs: z.array(dmnOutputSchema).max(MAX_OUTPUTS).default([]),
  rules: z.array(dmnRuleSchema).max(MAX_RULES).default([]),
});

const updateBodySchema = z.object({
  name: z.string().min(1).max(200).optional(),
  description: z.string().max(2000).optional(),
  hitPolicy: hitPolicySchema.optional(),
  inputs: z.array(dmnInputSchema).max(MAX_INPUTS).optional(),
  outputs: z.array(dmnOutputSchema).max(MAX_OUTPUTS).optional(),
  rules: z.array(dmnRuleSchema).max(MAX_RULES).optional(),
  version: z.number().int().positive(),
});

const paginationSchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(200).default(20),
});

const executeBodySchema = z.object({
  input: z.record(z.unknown()),
});

// ── Routes ────────────────────────────────────────────────────────

export async function dmnRoutes(app: FastifyInstance): Promise<void> {
  /** POST /v1/workflow/dmn/tables — create new decision table */
  app.post("/v1/workflow/dmn/tables", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, ADMIN_ROLES);
    const body = createBodySchema.parse(req.body);

    return sendAccepted(reply, acceptedResponseSchema, await commands.createTable(ctx, body));
  });

  /** GET /v1/workflow/dmn/tables — list decision tables */
  app.get("/v1/workflow/dmn/tables", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, ROLES);
    const { page, pageSize } = paginationSchema.parse(req.query);
    const offset = (page - 1) * pageSize;

    const rows = await scopedRead((tx) => tx
      .select()
      .from(dmnTables)
      .where(
        and(
          eq(dmnTables.tenantId, ctx.tenantId),
        ),
      )
      .orderBy(desc(dmnTables.updatedAt))
      .limit(pageSize)
      .offset(offset));

    const countRows = await scopedRead((tx) => tx
      .select({ id: dmnTables.id })
      .from(dmnTables)
      .where(eq(dmnTables.tenantId, ctx.tenantId)));

    return reply.send({
      data: rows.map((r) => ({
        id: r.id,
        name: r.name,
        description: r.description,
        hitPolicy: r.hitPolicy,
        status: r.status,
        version: r.version,
        inputCount: (r.inputs as DmnInput[]).length,
        outputCount: (r.outputs as DmnOutput[]).length,
        ruleCount: (r.rules as DmnRule[]).length,
        createdAt: r.createdAt,
        updatedAt: r.updatedAt,
        createdBy: r.createdBy,
        updatedBy: r.updatedBy,
      })),
      meta: { page, pageSize, total: countRows.length },
    });
  });

  /** GET /v1/workflow/dmn/tables/:id — get single */
  app.get("/v1/workflow/dmn/tables/:id", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, ROLES);
    const { id } = z.object({ id: z.string().uuid() }).parse(req.params);

    const rows = await scopedRead((tx) => tx
      .select()
      .from(dmnTables)
      .where(
        and(
          eq(dmnTables.id, id),
          eq(dmnTables.tenantId, ctx.tenantId),
        ),
      )
      .limit(1));

    const row = rows[0];
    if (!row || row.status === "deleted") {
      throw new HttpError(404, "NOT_FOUND", "DMN table not found");
    }

    return reply.send({ data: row });
  });

  /** PATCH /v1/workflow/dmn/tables/:id — update with optimistic locking */
  app.patch("/v1/workflow/dmn/tables/:id", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, ADMIN_ROLES);
    const { id } = z.object({ id: z.string().uuid() }).parse(req.params);
    const body = updateBodySchema.parse(req.body);

    return sendAccepted(reply, acceptedResponseSchema, await commands.updateTable(ctx, id, body));
  });

  /** DELETE /v1/workflow/dmn/tables/:id — soft-delete */
  app.delete("/v1/workflow/dmn/tables/:id", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, ADMIN_ROLES);
    const { id } = z.object({ id: z.string().uuid() }).parse(req.params);

    const rows = await scopedRead((tx) => tx
      .select()
      .from(dmnTables)
      .where(
        and(
          eq(dmnTables.id, id),
          eq(dmnTables.tenantId, ctx.tenantId),
        ),
      )
      .limit(1));

    const existing = rows[0];
    if (!existing || existing.status === "deleted") {
      throw new HttpError(404, "NOT_FOUND", "DMN table not found");
    }

    return sendAccepted(reply, acceptedResponseSchema, await commands.deleteTable(ctx, id));
  });

  /** POST /v1/workflow/dmn/tables/:id/execute — evaluate decision table */
  app.post("/v1/workflow/dmn/tables/:id/execute", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, ROLES);
    const { id } = z.object({ id: z.string().uuid() }).parse(req.params);
    const body = executeBodySchema.parse(req.body);

    const rows = await scopedRead((tx) => tx
      .select()
      .from(dmnTables)
      .where(
        and(
          eq(dmnTables.id, id),
          eq(dmnTables.tenantId, ctx.tenantId),
        ),
      )
      .limit(1));

    const row = rows[0];
    if (!row || row.status === "deleted") {
      throw new HttpError(404, "NOT_FOUND", "DMN table not found");
    }

    const tableDef: DmnTableDef = {
      hitPolicy: row.hitPolicy as DmnHitPolicy,
      inputs: row.inputs as DmnInput[],
      outputs: row.outputs as DmnOutput[],
      rules: row.rules as DmnRule[],
    };

    const result = evaluateDecisionTable(tableDef, body.input);

    return reply.send({ data: result });
  });

  // Error handler scoped to this plugin
  app.setErrorHandler((err, req, reply) => {
    const correlationId = (req.headers["x-correlation-id"] as string) ?? req.id;
    if (err instanceof ZodError) {
      return reply.code(400).send({
        error: {
          code: "VALIDATION_FAILED",
          message: "invalid request",
          details: err.issues.map((i) => ({ field: i.path.join("."), message: i.message })),
          correlationId,
        },
      });
    }
    if (err instanceof HttpError) {
      return reply.code(err.status).send({
        error: { code: err.code, message: err.message, correlationId },
      });
    }
    req.log.error({ err }, "unhandled error in DMN routes");
    return reply.code(500).send({
      error: { code: "INTERNAL", message: "internal error", correlationId },
    });
  });
}
