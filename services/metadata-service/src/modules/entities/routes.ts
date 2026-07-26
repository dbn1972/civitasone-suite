import type { FastifyInstance } from "fastify";
import { z, ZodError } from "zod";
import { randomUUID } from "node:crypto";
import { eq, and } from "drizzle-orm";
import { resolveContext, requireRole, HttpError } from "../../shared/context.js";
import { db } from "../../shared/db.js";
import { withTenant } from "../../shared/scope.js";
import { queue } from "../../shared/infra.js";
import { entityDefinitions } from "./schema.js";

const ADMIN = ["super_admin", "platform_admin", "metadata_admin"];

export async function entityRoutes(app: FastifyInstance): Promise<void> {
  app.get("/v1/metadata/entities", async (req, reply) => {
    const ctx = resolveContext(req); requireRole(ctx, ADMIN);
    const entities = await withTenant(ctx.tenantId, (tx) =>
      tx.select().from(entityDefinitions).where(eq(entityDefinitions.tenantId, ctx.tenantId)));
    return reply.send({ data: entities, meta: { total: entities.length } });
  });

  app.get("/v1/metadata/entities/:id", async (req, reply) => {
    const ctx = resolveContext(req); requireRole(ctx, ADMIN);
    const { id } = z.object({ id: z.string().uuid() }).parse(req.params);
    const rows = await withTenant(ctx.tenantId, (tx) =>
      tx.select().from(entityDefinitions).where(and(eq(entityDefinitions.id, id), eq(entityDefinitions.tenantId, ctx.tenantId))).limit(1));
    if (!rows[0]) throw new HttpError(404, "NOT_FOUND", "Entity definition not found");
    return reply.send({ data: rows[0] });
  });

  app.post("/v1/metadata/entities", async (req, reply) => {
    const ctx = resolveContext(req); requireRole(ctx, ADMIN);
    const body = z.object({ apiName: z.string().min(1).max(128).regex(/^[a-z][a-z0-9_]*$/), label: z.string().min(1).max(256), pluralLabel: z.string().min(1).max(256), description: z.string().max(2000).optional(), icon: z.string().max(64).optional() }).parse(req.body);
    const id = randomUUID();
    await queue.publish("metadata.entity.create", { messageId: id, type: "metadata.entity.create", tenantId: ctx.tenantId, actorId: ctx.actorId, correlationId: ctx.correlationId, schemaVersion: "1.0", payload: { id, tenantId: ctx.tenantId, ...body } });
    return reply.code(202).send({ data: { id, status: "accepted" } });
  });

  app.patch("/v1/metadata/entities/:id", async (req, reply) => {
    const ctx = resolveContext(req); requireRole(ctx, ADMIN);
    const { id } = z.object({ id: z.string().uuid() }).parse(req.params);
    const body = z.object({ label: z.string().max(256).optional(), pluralLabel: z.string().max(256).optional(), description: z.string().max(2000).optional(), isActive: z.boolean().optional() }).parse(req.body);
    await queue.publish("metadata.entity.update", { messageId: randomUUID(), type: "metadata.entity.update", tenantId: ctx.tenantId, actorId: ctx.actorId, correlationId: ctx.correlationId, schemaVersion: "1.0", payload: { id, tenantId: ctx.tenantId, ...body } });
    return reply.code(202).send({ data: { id, status: "accepted" } });
  });

  /**
   * Publish an entity definition — maker-checker.
   * The entity's author cannot publish it; a different admin must approve. The
   * check and the state transition happen in the same tenant-scoped transaction.
   */
  app.post("/v1/metadata/entities/:id/publish", async (req, reply) => {
    const ctx = resolveContext(req); requireRole(ctx, ADMIN);
    const { id } = z.object({ id: z.string().uuid() }).parse(req.params);
    const row = await withTenant(ctx.tenantId, async (tx) => {
      const existing = await tx.select().from(entityDefinitions)
        .where(and(eq(entityDefinitions.id, id), eq(entityDefinitions.tenantId, ctx.tenantId))).limit(1);
      if (!existing[0]) throw new HttpError(404, "NOT_FOUND", "Entity definition not found");
      if (existing[0].publishedAt) throw new HttpError(409, "ALREADY_PUBLISHED", "Entity is already published");
      if (existing[0].createdBy === ctx.actorId) {
        throw new HttpError(403, "MAKER_CANNOT_CHECK", "the entity's author cannot publish it — a different admin must approve");
      }
      const [updated] = await tx.update(entityDefinitions)
        .set({ publishedAt: new Date(), publishedBy: ctx.actorId, isActive: true, updatedAt: new Date(), updatedBy: ctx.actorId })
        .where(and(eq(entityDefinitions.id, id), eq(entityDefinitions.tenantId, ctx.tenantId))).returning();
      return updated;
    });
    return reply.send({ data: row });
  });

  app.setErrorHandler((err, req, reply) => {
    const cid = (req.headers["x-correlation-id"] as string) ?? req.id;
    if (err instanceof ZodError) return reply.code(400).send({ code: "VALIDATION_FAILED", message: "invalid request", correlationId: cid });
    if (err instanceof HttpError) return reply.code(err.status).send({ code: err.code, message: err.message, correlationId: cid });
    req.log.error({ err }, "unhandled"); return reply.code(500).send({ code: "INTERNAL", message: "internal error", correlationId: cid });
  });
}
