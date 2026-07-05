import type { FastifyInstance } from "fastify";
import { ZodError, z } from "zod";
import { randomUUID } from "node:crypto";
import { resolveContext, requireRole, HttpError } from "../../shared/context.js";
import { db } from "../../shared/db.js";
import * as repo from "./repo.js";
import { evaluateDecisionTable, type DecisionTableDef } from "./domain.js";

const ROLES = ["workflow_user", "workflow_admin", "super_admin", "tenant_admin"];
const ADMIN_ROLES = ["workflow_admin", "super_admin", "tenant_admin"];

const createBody = z.object({
  code: z.string().min(1).max(64),
  name: z.string().min(1).max(200),
  hitPolicy: z.enum(["first", "collect", "unique"]).default("first"),
  inputs: z.array(z.object({
    key: z.string().min(1).max(64),
    label: z.string().min(1).max(200),
    type: z.enum(["string", "number", "boolean"]),
  })).default([]),
  outputs: z.array(z.object({
    key: z.string().min(1).max(64),
    label: z.string().min(1).max(200),
    type: z.enum(["string", "number", "boolean"]),
    defaultValue: z.unknown().optional(),
  })).default([]),
  rules: z.array(z.object({
    inputs: z.record(z.string()),
    outputs: z.record(z.unknown()),
    priority: z.number().int().optional(),
  })).default([]),
});

const evaluateBody = z.object({
  context: z.record(z.unknown()),
});

export async function decisionRoutes(app: FastifyInstance): Promise<void> {
  // Create a decision table
  app.post("/v1/workflow/decisions", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, ADMIN_ROLES);
    const body = createBody.parse(req.body);

    const id = randomUUID();
    await db.transaction(async (tx) => {
      await repo.insertDecisionTable(tx, {
        id,
        tenantId: ctx.tenantId,
        code: body.code,
        name: body.name,
        hitPolicy: body.hitPolicy,
        inputs: body.inputs,
        outputs: body.outputs,
        rules: body.rules,
        createdBy: ctx.actorId,
        updatedBy: ctx.actorId,
      });
    });

    return reply.code(201).send({ data: { id, code: body.code, name: body.name, status: "draft" } });
  });

  // List decision tables
  app.get("/v1/workflow/decisions", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, ROLES);
    const q = z.object({
      limit: z.coerce.number().int().min(1).max(200).default(50),
      offset: z.coerce.number().int().min(0).default(0),
    }).parse(req.query);
    const rows = await repo.listByTenant(ctx.tenantId, q.limit, q.offset);
    return reply.send({ data: rows });
  });

  // Get a decision table by ID
  app.get("/v1/workflow/decisions/:id", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, ROLES);
    const { id } = z.object({ id: z.string().uuid() }).parse(req.params);
    const row = await repo.findById(id, ctx.tenantId);
    if (!row) throw new HttpError(404, "NOT_FOUND", "decision table not found");
    return reply.send({ data: row });
  });

  // Deploy a decision table
  app.post("/v1/workflow/decisions/:id/deploy", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, ADMIN_ROLES);
    const { id } = z.object({ id: z.string().uuid() }).parse(req.params);

    const row = await repo.findById(id, ctx.tenantId);
    if (!row) throw new HttpError(404, "NOT_FOUND", "decision table not found");
    if (row.status === "active") throw new HttpError(409, "ALREADY_DEPLOYED", "decision table already deployed");

    await db.transaction(async (tx) => {
      await repo.deployVersion(tx, id, ctx.tenantId, ctx.actorId);
    });

    return reply.send({ data: { ...row, status: "active" }, message: "decision table deployed" });
  });

  // Evaluate a decision table by code
  app.post("/v1/workflow/decisions/:code/evaluate", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, ROLES);
    const { code } = z.object({ code: z.string().min(1).max(64) }).parse(req.params);
    const body = evaluateBody.parse(req.body);

    const table = await repo.findByCode(ctx.tenantId, code);
    if (!table) throw new HttpError(404, "NOT_FOUND", "no active decision table with this code");

    const result = evaluateDecisionTable(table as unknown as DecisionTableDef, body.context);
    return reply.send({ data: result });
  });

  app.setErrorHandler((err, req, reply) => {
    const correlationId = (req.headers["x-correlation-id"] as string) ?? req.id;
    if (err instanceof ZodError) {
      return reply.code(400).send({ code: "VALIDATION_FAILED", message: "invalid request", correlationId, retryable: false });
    }
    if (err instanceof HttpError) {
      return reply.code(err.status).send({ code: err.code, message: err.message, correlationId, retryable: false });
    }
    req.log.error({ err }, "unhandled error");
    return reply.code(500).send({ code: "INTERNAL", message: "internal error", correlationId, retryable: true });
  });
}
