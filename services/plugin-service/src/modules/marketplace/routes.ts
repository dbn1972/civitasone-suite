import type { FastifyInstance } from "fastify";
import { z, ZodError } from "zod";
import { randomUUID } from "node:crypto";
import { runWithTenant } from "@civitasone/db";
import { resolveContext, requireRole, HttpError } from "../../shared/context.js";
import { db } from "../../shared/db.js";
import { queue } from "../../shared/infra.js";
import { COMMANDS } from "../../topics.js";
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
  // Install is asynchronous (202): the plugin.marketplace.install consumer performs it.
  // A reason is mandatory (GAP-PLUGINS-MARKETPLACE-01) and is recorded in the audit.
  app.post("/v1/plugins/marketplace/:id/install", async (req, reply) => {
    const ctx = resolveContext(req); requireRole(ctx, ADMIN);
    const { id } = z.object({ id: z.string().uuid() }).parse(req.params);
    const { reason } = z.object({ reason: z.string().trim().min(3).max(500) }).parse(req.body ?? {});
    const listing = await repo.findListing(id);
    if (!listing || !listing.isActive) throw new HttpError(404, "NOT_FOUND", "Plugin not found");
    const installId = randomUUID();
    await queue.publish(COMMANDS.marketplaceInstall, { messageId: installId, type: COMMANDS.marketplaceInstall, tenantId: ctx.tenantId, actorId: ctx.actorId, correlationId: ctx.correlationId, schemaVersion: "1.0", payload: { installId, pluginId: id, tenantId: ctx.tenantId, reason } });
    return reply.code(202).send({ data: { installId, pluginId: id, status: "install_requested" } });
  });
  // Honest async state for the web to poll: "installed" only once the registry row exists.
  app.get("/v1/plugins/marketplace/:id/install-status", async (req, reply) => {
    const ctx = resolveContext(req); requireRole(ctx, ADMIN);
    const { id } = z.object({ id: z.string().uuid() }).parse(req.params);
    const row = await runWithTenant(ctx.tenantId, () => db.transaction((tx) => repo.findInstalledByListingTx(tx, ctx.tenantId, id)));
    return reply.send({ data: { pluginId: id, status: row ? "installed" : "install_requested", ...(row ? { installId: row.id, state: row.state } : {}) } });
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
