import type { FastifyInstance } from "fastify";
import { z, ZodError } from "zod";
import { randomUUID } from "node:crypto";
import { resolveContext, requireRole, HttpError } from "../../shared/context.js";
import { queue } from "../../shared/infra.js";
import * as repo from "./repo.js";

const ADMIN = ["super_admin", "platform_admin", "tenant_admin"];

export async function orgHierarchyRoutes(app: FastifyInstance): Promise<void> {
  // Real DB read — returns actual org units from PostgreSQL
  app.get("/v1/org/hierarchy", async (req, reply) => {
    const ctx = resolveContext(req); requireRole(ctx, ADMIN);
    const units = await repo.listOrgUnits(ctx.tenantId);
    return reply.send({ data: units, meta: { total: units.length } });
  });

  // Get a single unit with its children
  app.get("/v1/org/hierarchy/:id", async (req, reply) => {
    const ctx = resolveContext(req); requireRole(ctx, ADMIN);
    const { id } = z.object({ id: z.string().uuid() }).parse(req.params);
    const unit = await repo.findById(ctx.tenantId, id);
    if (!unit) throw new HttpError(404, "NOT_FOUND", "Org unit not found");
    const children = await repo.findChildren(ctx.tenantId, id);
    return reply.send({ data: { ...unit, children } });
  });

  // Get subtree (recursive via repeated queries — production would use CTE)
  app.get("/v1/org/hierarchy/:id/subtree", async (req, reply) => {
    const ctx = resolveContext(req); requireRole(ctx, ADMIN);
    const { id } = z.object({ id: z.string().uuid() }).parse(req.params);
    const root = await repo.findById(ctx.tenantId, id);
    if (!root) throw new HttpError(404, "NOT_FOUND", "Org unit not found");
    // Breadth-first traversal
    const tree: typeof root[] = [root];
    const queue_ids = [id];
    while (queue_ids.length > 0 && tree.length < 500) {
      const parentId = queue_ids.shift()!;
      const children = await repo.findChildren(ctx.tenantId, parentId);
      for (const child of children) { tree.push(child); queue_ids.push(child.id); }
    }
    return reply.send({ data: tree, meta: { total: tree.length } });
  });

  // CQRS write — publish command to queue
  app.post("/v1/org/hierarchy", async (req, reply) => {
    const ctx = resolveContext(req); requireRole(ctx, ADMIN);
    const body = z.object({
      name: z.string().min(1).max(200),
      type: z.enum(["department", "division", "section", "unit", "branch"]),
      parentId: z.string().uuid().optional(),
      headUserId: z.string().uuid().optional(),
      code: z.string().max(32).optional(),
    }).parse(req.body);
    const id = randomUUID();
    await queue.publish("tenant.org_unit.create", { messageId: id, type: "tenant.org_unit.create", tenantId: ctx.tenantId, actorId: ctx.actorId, correlationId: ctx.correlationId, schemaVersion: "1.0", payload: { id, tenantId: ctx.tenantId, ...body } });
    return reply.code(202).send({ data: { id, status: "accepted" } });
  });

  // Update an org unit
  app.patch("/v1/org/hierarchy/:id", async (req, reply) => {
    const ctx = resolveContext(req); requireRole(ctx, ADMIN);
    const { id } = z.object({ id: z.string().uuid() }).parse(req.params);
    const body = z.object({
      name: z.string().min(1).max(200).optional(),
      type: z.enum(["department", "division", "section", "unit", "branch"]).optional(),
      parentId: z.string().uuid().nullable().optional(),
      headUserId: z.string().uuid().nullable().optional(),
      code: z.string().max(32).nullable().optional(),
    }).parse(req.body);
    const existing = await repo.findById(ctx.tenantId, id);
    if (!existing) throw new HttpError(404, "NOT_FOUND", "Org unit not found");
    await queue.publish("tenant.org_unit.update", { messageId: randomUUID(), type: "tenant.org_unit.update", tenantId: ctx.tenantId, actorId: ctx.actorId, correlationId: ctx.correlationId, schemaVersion: "1.0", payload: { id, tenantId: ctx.tenantId, ...body } });
    return reply.code(202).send({ data: { id, status: "accepted" } });
  });

  // Master data import (CQRS — queued)
  app.post("/v1/org/master-data/import", async (req, reply) => {
    const ctx = resolveContext(req); requireRole(ctx, ADMIN);
    const body = z.object({ entityType: z.string().min(1), records: z.array(z.record(z.unknown())).min(1).max(5000) }).parse(req.body);
    const batchId = randomUUID();
    await queue.publish("tenant.master_data.import", { messageId: batchId, type: "tenant.master_data.import", tenantId: ctx.tenantId, actorId: ctx.actorId, correlationId: ctx.correlationId, schemaVersion: "1.0", payload: { batchId, entityType: body.entityType, recordCount: body.records.length, records: body.records } });
    return reply.code(202).send({ data: { batchId, status: "queued", recordCount: body.records.length } });
  });

  // Master data export
  app.post("/v1/org/master-data/export", async (req, reply) => {
    const ctx = resolveContext(req); requireRole(ctx, ADMIN);
    const body = z.object({ entityType: z.string().min(1), format: z.enum(["csv", "json"]).default("json") }).parse(req.body);
    const exportId = randomUUID();
    await queue.publish("tenant.master_data.export", { messageId: exportId, type: "tenant.master_data.export", tenantId: ctx.tenantId, actorId: ctx.actorId, correlationId: ctx.correlationId, schemaVersion: "1.0", payload: { exportId, entityType: body.entityType, format: body.format, tenantId: ctx.tenantId } });
    return reply.code(202).send({ data: { exportId, status: "generating", format: body.format } });
  });

  app.setErrorHandler((err, req, reply) => {
    const cid = (req.headers["x-correlation-id"] as string) ?? req.id;
    if (err instanceof ZodError) return reply.code(400).send({ code: "VALIDATION_FAILED", message: "invalid request", correlationId: cid });
    if (err instanceof HttpError) return reply.code(err.status).send({ code: err.code, message: err.message, correlationId: cid });
    req.log.error({ err }, "unhandled"); return reply.code(500).send({ code: "INTERNAL", message: "internal error", correlationId: cid });
  });
}
