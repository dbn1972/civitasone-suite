import type { FastifyInstance } from "fastify";
import { z, ZodError } from "zod";
import { randomUUID } from "node:crypto";
import { resolveContext, requireRole, HttpError } from "../../shared/context.js";
import { queue } from "../../shared/infra.js";
import * as repo from "./repo.js";
const ADMIN = ["super_admin", "platform_admin"];
export async function marketplaceRoutes(app: FastifyInstance): Promise<void> {
  app.get("/v1/plugins/marketplace", async (req, reply) => {
    const ctx = resolveContext(req); requireRole(ctx, ADMIN);
    const listings = await repo.listListings();
    return reply.send({ data: listings, meta: { total: listings.length } });
  });
  app.get("/v1/plugins/marketplace/:id", async (req, reply) => {
    const ctx = resolveContext(req); requireRole(ctx, ADMIN);
    const { id } = z.object({ id: z.string().uuid() }).parse(req.params);
    const listing = await repo.findListing(id);
    if (!listing) throw new HttpError(404, "NOT_FOUND", "Plugin not found");
    return reply.send({ data: listing });
  });
  app.post("/v1/plugins/marketplace/:id/install", async (req, reply) => {
    const ctx = resolveContext(req); requireRole(ctx, ADMIN);
    const { id } = z.object({ id: z.string().uuid() }).parse(req.params);
    const installId = randomUUID();
    await queue.publish("plugin.marketplace.install", { messageId: installId, type: "plugin.marketplace.install", tenantId: ctx.tenantId, actorId: ctx.actorId, correlationId: ctx.correlationId, schemaVersion: "1.0", payload: { installId, pluginId: id, tenantId: ctx.tenantId } });
    return reply.code(202).send({ data: { installId, pluginId: id, status: "installing" } });
  });
  app.post("/v1/plugins/marketplace/:id/review", async (req, reply) => {
    const ctx = resolveContext(req); requireRole(ctx, ADMIN);
    const { id } = z.object({ id: z.string().uuid() }).parse(req.params);
    const body = z.object({ rating: z.number().int().min(1).max(5), comment: z.string().max(1000).optional() }).parse(req.body);
    await queue.publish("plugin.marketplace.review", { messageId: randomUUID(), type: "plugin.marketplace.review", tenantId: ctx.tenantId, actorId: ctx.actorId, correlationId: ctx.correlationId, schemaVersion: "1.0", payload: { pluginId: id, ...body, reviewerId: ctx.actorId } });
    return reply.code(202).send({ data: { pluginId: id, status: "accepted" } });
  });
  app.setErrorHandler((err, req, reply) => {
    const cid = (req.headers["x-correlation-id"] as string) ?? req.id;
    if (err instanceof ZodError) return reply.code(400).send({ code: "VALIDATION_FAILED", message: "invalid request", correlationId: cid });
    if (err instanceof HttpError) return reply.code(err.status).send({ code: err.code, message: err.message, correlationId: cid });
    req.log.error({ err }, "unhandled"); return reply.code(500).send({ code: "INTERNAL", message: "internal error", correlationId: cid });
  });
}
