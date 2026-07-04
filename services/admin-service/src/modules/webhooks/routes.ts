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

/**
 * SSRF guard: block private, loopback, and link-local IP ranges in webhook URLs.
 * Resolves hostname and rejects internal network destinations.
 */
function isBlockedUrl(url: string): boolean {
  try {
    const parsed = new URL(url);
    const host = parsed.hostname.toLowerCase();
    // Block explicit loopback
    if (host === "localhost" || host === "127.0.0.1" || host === "::1" || host === "[::1]") return true;
    // Block 0.0.0.0
    if (host === "0.0.0.0") return true;
    // Block metadata endpoints (cloud providers)
    if (host === "169.254.169.254" || host === "metadata.google.internal") return true;
    // Block private IPv4 ranges
    const ipv4 = host.match(/^(\d+)\.(\d+)\.(\d+)\.(\d+)$/);
    if (ipv4) {
      const [, a, b] = ipv4.map(Number);
      if (a === 10) return true;                            // 10.0.0.0/8
      if (a === 172 && b! >= 16 && b! <= 31) return true;  // 172.16.0.0/12
      if (a === 192 && b === 168) return true;              // 192.168.0.0/16
      if (a === 169 && b === 254) return true;              // link-local
      if (a === 127) return true;                           // loopback
    }
    // Block non-https in production (optional hardening)
    if (process.env.NODE_ENV === "production" && parsed.protocol !== "https:") return true;
    return false;
  } catch {
    return true; // malformed → block
  }
}

const createBody = z.object({
  url: z.string().url().max(2048).refine((u) => !isBlockedUrl(u), { message: "URL targets a blocked network range (private/loopback/link-local)" }),
  events: z.array(z.string().min(1).max(200)).min(1),
  description: z.string().max(500).optional(),
});

const updateBody = z.object({
  url: z.string().url().max(2048).refine((u) => !isBlockedUrl(u), { message: "URL targets a blocked network range" }).optional(),
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
