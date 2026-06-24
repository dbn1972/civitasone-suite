import type { FastifyInstance } from "fastify";
import { ZodError, z } from "zod";
import { randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import { resolveContext, requireRole, HttpError } from "../../shared/context.js";
import { db } from "../../shared/db.js";
import { definitions } from "./schema.js";
import * as repo from "./repo.js";

const ROLES = ["workflow_user", "workflow_admin", "super_admin", "tenant_admin"];
const ADMIN_ROLES = ["workflow_admin", "super_admin", "tenant_admin"];

const nodeSchema = z.object({
  nodeKey: z.string().min(1).max(64),
  name: z.string().min(1).max(200),
  roleRef: z.string().max(128).optional(),
  nodeType: z.enum(["task", "split", "join", "start", "end"]).default("task"),
  slaMinutes: z.number().int().positive().optional(),
  sortOrder: z.number().int().optional(),
});
const edgeSchema = z.object({
  fromNode: z.string().min(1).max(64),
  toNode: z.string().min(1).max(64),
  condition: z.string().max(512).optional(),
  sortOrder: z.number().int().optional(),
});
const createBody = z.object({
  code: z.string().min(1).max(64),
  name: z.string().min(1).max(200),
  description: z.string().max(1000).optional(),
  nodes: z.array(nodeSchema).default([]),
  edges: z.array(edgeSchema).default([]),
});

export async function definitionRoutes(app: FastifyInstance): Promise<void> {
  // Create a NEW definition, or — if a definition with this code already exists —
  // create version N+1 (archiving prior versions on deploy). DB-backed + transactional.
  app.post("/v1/workflow/definitions", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, ADMIN_ROLES);
    const body = createBody.parse(req.body);

    const id = randomUUID();
    const result = await db.transaction(async (tx) => {
      const latest = await repo.findLatestVersionTx(tx, ctx.tenantId, body.code);
      const version = latest ? latest.version + 1 : 1;
      await tx.insert(definitions).values({
        id,
        tenantId: ctx.tenantId,
        code: body.code,
        name: body.name,
        ...(body.description !== undefined ? { description: body.description } : {}),
        version,
        status: "draft",
        createdBy: ctx.actorId,
        updatedBy: ctx.actorId,
      });
      await repo.insertGraphTx(tx, id, body.nodes, body.edges);
      return { version };
    });

    return reply.code(201).send({
      data: { id, code: body.code, name: body.name, version: result.version, status: "draft" },
    });
  });

  app.get("/v1/workflow/definitions", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, ROLES);
    const q = z.object({
      limit: z.coerce.number().int().min(1).max(200).default(50),
      offset: z.coerce.number().int().min(0).default(0),
    }).parse(req.query);
    const rows = await repo.findByTenant(ctx.tenantId, q.limit, q.offset);
    return reply.send({ data: rows });
  });

  app.get("/v1/workflow/definitions/:id", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, ROLES);
    const { id } = z.object({ id: z.string().uuid() }).parse(req.params);
    const def = await repo.findById(id, ctx.tenantId);
    if (!def) throw new HttpError(404, "NOT_FOUND", "definition not found");
    const [nodes, edges] = await Promise.all([repo.listNodes(id), repo.listEdges(id)]);
    return reply.send({ data: { ...def, nodes, edges } });
  });

  // Deploy: activate this version and archive every other version of the same code.
  app.post("/v1/workflow/definitions/:id/deploy", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, ADMIN_ROLES);
    const { id } = z.object({ id: z.string().uuid() }).parse(req.params);

    const result = await db.transaction(async (tx) => {
      const def = await repo.findById(id, ctx.tenantId);
      if (!def) throw new HttpError(404, "NOT_FOUND", "definition not found");
      if (def.status === "active") throw new HttpError(409, "ALREADY_DEPLOYED", "definition already deployed");
      await tx.update(definitions)
        .set({ status: "active", updatedBy: ctx.actorId, updatedAt: new Date() })
        .where(eq(definitions.id, id));
      await repo.archiveOtherVersionsTx(tx, ctx.tenantId, def.code, id);
      return { ...def, status: "active" };
    });

    return reply.send({ data: result, message: "definition deployed" });
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
