/**
 * Webhooks module HTTP routes (Fastify plugin).
 * CRUD for outbound webhooks + delivery log + test endpoint.
 */
import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { resolveContext, requireRole, HttpError, TENANT_ADMIN_ROLES } from "../../shared/context.js";
import { cache } from "../../shared/infra.js";
import * as commands from "./commands.js";
import { webhooks, webhookDeliveries } from "./schema.js";
import { db } from "../../shared/db.js";
import { eq, and, desc } from "drizzle-orm";

const RESOURCE = "webhook";

const createBody = z.object({
  url: z.string().url().max(2048),
  events: z.array(z.string().min(1).max(200)).min(1),
  description: z.string().max(500).optional(),
});

const updateBody = z.object({
  url: z.string().url().max(2048).optional(),
  events: z.array(z.string().min(1).max(200)).optional(),
  active: z.boolean().optional(),
  description: z.string().max(500).optional(),
});

const idParam = z.object({ id: z.string().uuid() });

function safeParse<T>(schema: z.ZodSchema<T>, data: unknown): T {
  const result = schema.safeParse(data);
  if (!result.success) {
    const msg = result.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("; ");
    throw new HttpError(400, "VALIDATION_FAILED", msg);
  }
  return result.data;
}

export async function webhookRoutes(app: FastifyInstance): Promise<void> {
  // LIST webhooks for tenant
  app.get("/v1/admin/webhooks", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, [...TENANT_ADMIN_ROLES]);
    const rows = await cache.getOrLoad(
      cache.makeKey(ctx.tenantId, RESOURCE, "list"),
      async () => db.select().from(webhooks).where(eq(webhooks.tenantId, ctx.tenantId)),
    );
    // Strip secret from list response
    const sanitized = rows.map(({ secret, ...rest }) => ({ ...rest, secretMasked: `${secret.slice(0, 10)}...` }));
    return reply.send({ data: sanitized });
  });

  // CREATE webhook
  app.post("/v1/admin/webhooks", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, [...TENANT_ADMIN_ROLES]);
    const body = safeParse(createBody, req.body);
    const result = await commands.webhookCreate(ctx, body);
    // Return secret only on creation (one-time)
    return reply.code(202).send(result);
  });

  // UPDATE webhook
  app.put("/v1/admin/webhooks/:id", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, [...TENANT_ADMIN_ROLES]);
    const { id } = safeParse(idParam, req.params);
    const body = safeParse(updateBody, req.body);
    if (Object.keys(body).length === 0) {
      throw new HttpError(400, "EMPTY_BODY", "at least one field must be provided");
    }
    const result = await commands.webhookUpdate(ctx, id, body);
    return reply.code(202).send(result);
  });

  // DELETE webhook
  app.delete("/v1/admin/webhooks/:id", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, [...TENANT_ADMIN_ROLES]);
    const { id } = safeParse(idParam, req.params);
    const result = await commands.webhookDelete(ctx, id);
    return reply.code(202).send(result);
  });

  // GET delivery log for a webhook
  app.get("/v1/admin/webhooks/:id/deliveries", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, [...TENANT_ADMIN_ROLES]);
    const { id } = safeParse(idParam, req.params);
    // Verify ownership
    const wh = await db.select().from(webhooks)
      .where(and(eq(webhooks.id, id), eq(webhooks.tenantId, ctx.tenantId)))
      .limit(1);
    if (!wh[0]) throw new HttpError(404, "NOT_FOUND", "webhook not found");
    const deliveries = await db.select().from(webhookDeliveries)
      .where(eq(webhookDeliveries.webhookId, id))
      .orderBy(desc(webhookDeliveries.createdAt))
      .limit(100);
    return reply.send({ data: deliveries });
  });

  // SEND test event
  app.post("/v1/admin/webhooks/:id/test", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, [...TENANT_ADMIN_ROLES]);
    const { id } = safeParse(idParam, req.params);
    const result = await commands.webhookTest(ctx, id);
    return reply.code(202).send(result);
  });
}
