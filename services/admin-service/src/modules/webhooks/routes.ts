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
import { scopedRead } from "../../shared/db.js";
import { eq, and, desc } from "drizzle-orm";

const RESOURCE = "webhook";

/**
 * SSRF guard: block private, loopback, and link-local IP ranges in webhook URLs.
 * H6 FIX: Now resolves hostnames via DNS to detect rebinding attacks.
 * Checks both string-based patterns AND resolved A/AAAA records.
 */
import { resolve4, resolve6 } from "node:dns/promises";

function isPrivateIp(ip: string): boolean {
  // IPv4 checks
  const ipv4 = ip.match(/^(\d+)\.(\d+)\.(\d+)\.(\d+)$/);
  if (ipv4) {
    const [, a, b] = ipv4.map(Number);
    if (a === 10) return true;                            // 10.0.0.0/8
    if (a === 172 && b! >= 16 && b! <= 31) return true;  // 172.16.0.0/12
    if (a === 192 && b === 168) return true;              // 192.168.0.0/16
    if (a === 169 && b === 254) return true;              // link-local
    if (a === 127) return true;                           // loopback
    if (a === 0) return true;                             // 0.0.0.0/8
  }
  // IPv6 checks
  if (ip === "::1" || ip === "::") return true;
  if (ip.startsWith("fe80:")) return true;  // link-local
  if (ip.startsWith("fc") || ip.startsWith("fd")) return true; // unique local
  return false;
}

function isBlockedUrl(url: string): boolean {
  try {
    const parsed = new URL(url);
    // Block every non-http(s) scheme unconditionally (file://, gopher://,
    // ftp://, javascript:, data:, etc.). This was previously gated behind
    // `NODE_ENV === "production"` only — zod's `.url()` accepts any scheme,
    // so in dev/test/staging a webhook URL like `file:///etc/passwd` or
    // `gopher://internal-host` passed validation untouched (its hostname is
    // empty or arbitrary, so it never matched the private-IP checks below
    // either). There is no legitimate use case for a non-http(s) webhook
    // target in any environment, so this check no longer depends on
    // NODE_ENV.
    if (parsed.protocol !== "http:" && parsed.protocol !== "https:") return true;
    const host = parsed.hostname.toLowerCase();
    // Block explicit loopback
    if (host === "localhost" || host === "127.0.0.1" || host === "::1" || host === "[::1]") return true;
    // Block 0.0.0.0
    if (host === "0.0.0.0") return true;
    // Block metadata endpoints (cloud providers)
    if (host === "169.254.169.254" || host === "metadata.google.internal") return true;
    // Block private IPv4 ranges (string-based first check)
    if (isPrivateIp(host)) return true;
    // Additionally require https specifically (not just http) in production.
    if (process.env.NODE_ENV === "production" && parsed.protocol !== "https:") return true;
    return false;
  } catch {
    return true; // malformed → block
  }
}

/**
 * H6 FIX: Resolve hostname via DNS and check if ANY resolved address is private.
 * This defeats DNS rebinding attacks where a hostname initially resolves to a
 * public IP but later resolves to 169.254.169.254 (metadata) or 127.0.0.1.
 * Must be called at BOTH registration AND delivery time.
 */
async function isBlockedAfterResolve(url: string): Promise<boolean> {
  if (isBlockedUrl(url)) return true;
  try {
    const parsed = new URL(url);
    const host = parsed.hostname.toLowerCase();
    // If it's already an IP, the string check above handles it
    if (/^[\d.]+$/.test(host) || host.includes(":")) return false;
    // Resolve A and AAAA records
    const [ipv4s, ipv6s] = await Promise.allSettled([
      resolve4(host),
      resolve6(host),
    ]);
    const allIps: string[] = [];
    if (ipv4s.status === "fulfilled") allIps.push(...ipv4s.value);
    if (ipv6s.status === "fulfilled") allIps.push(...ipv6s.value);
    // If ANY resolved IP is private, block it
    return allIps.some(isPrivateIp);
  } catch {
    // DNS resolution failure — block by default (fail-closed)
    return true;
  }
}

// Export for use in delivery consumer (re-check at send time)
export { isBlockedAfterResolve, isBlockedUrl, isPrivateIp };

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

// See custom-domains/routes.ts safeParse for why Input is widened to `any`
// instead of using z.ZodSchema<T> (Input=T): schemas with `.default(...)`
// fields need T inferred from the parsed *output*, not the optional *input*.
function safeParse<T>(schema: z.ZodType<T, z.ZodTypeDef, any>, data: unknown): T {
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
    const rows = (await cache.getOrLoad(
      cache.makeKey(ctx.tenantId, RESOURCE, "list"),
      // Wrapped in scopedRead() (db.transaction) so wrapWithTenantGuc injects
      // app.tenant_id before this read — a bare db.select() under FORCE RLS
      // returns zero rows with no GUC set.
      async () => scopedRead((tx) => tx.select().from(webhooks).where(eq(webhooks.tenantId, ctx.tenantId))),
    )) ?? [];
    // Strip secret from list response
    const sanitized = rows.map(({ secret, ...rest }) => ({ ...rest, secretMasked: `${secret.slice(0, 10)}...` }));
    return reply.send({ data: sanitized });
  });

  // CREATE webhook
  app.post("/v1/admin/webhooks", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, [...TENANT_ADMIN_ROLES]);
    const body = safeParse(createBody, req.body);
    // H6 FIX: DNS resolution check at registration time (defeats rebinding)
    if (await isBlockedAfterResolve(body.url)) {
      throw new HttpError(422, "SSRF_BLOCKED", "URL resolves to a private/loopback/link-local address");
    }
    // exactOptionalPropertyTypes: only include description when provided.
    const result = await commands.webhookCreate(ctx, {
      url: body.url,
      events: body.events,
      ...(body.description !== undefined ? { description: body.description } : {}),
    });
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
    // SSRF FIX: the create route re-checks the URL with DNS resolution
    // (isBlockedAfterResolve, which defeats rebinding — a hostname that
    // resolves to a public IP at registration time but a private/metadata
    // IP later) via `isBlockedAfterResolve`. This update route previously
    // only ran the synchronous, string-based `isBlockedUrl` (via the zod
    // `.refine()` on `updateBody`), never the DNS-resolution check — so an
    // attacker could register a webhook with a benign public URL, then
    // PUT-update it to a hostname whose DNS resolves to
    // 169.254.169.254/private ranges, bypassing rebinding protection
    // entirely on the update path. Re-check here whenever `url` changes.
    if (body.url !== undefined && (await isBlockedAfterResolve(body.url))) {
      throw new HttpError(422, "SSRF_BLOCKED", "URL resolves to a private/loopback/link-local address");
    }
    // exactOptionalPropertyTypes: strip undefined keys so the payload only
    // ever carries defined values for WebhookUpdatePayload's optional fields.
    const patch = Object.fromEntries(
      Object.entries(body).filter(([, v]) => v !== undefined),
    ) as commands.WebhookUpdatePayload;
    const result = await commands.webhookUpdate(ctx, id, patch);
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
    // Verify ownership. Wrapped in scopedRead() (db.transaction) so
    // wrapWithTenantGuc injects app.tenant_id before these reads — a bare
    // db.select() under FORCE RLS returns zero rows with no GUC set.
    const wh = await scopedRead((tx) => tx.select().from(webhooks)
      .where(and(eq(webhooks.id, id), eq(webhooks.tenantId, ctx.tenantId)))
      .limit(1));
    if (!wh[0]) throw new HttpError(404, "NOT_FOUND", "webhook not found");
    const deliveries = await scopedRead((tx) => tx.select().from(webhookDeliveries)
      .where(eq(webhookDeliveries.webhookId, id))
      .orderBy(desc(webhookDeliveries.createdAt))
      .limit(100));
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
