/**
 * Webhooks module HTTP routes (Fastify plugin).
 * CRUD for outbound webhooks + delivery log + test endpoint.
 * CAP-054: delivery replay + maker-checker HMAC secret rotation.
 */
import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { resolveContext, requireRole, HttpError, TENANT_ADMIN_ROLES } from "../../shared/context.js";
import { cache } from "../../shared/infra.js";
import * as commands from "./commands.js";
import { webhooks, webhookDeliveries, secretRotations } from "./schema.js";
import { canReplay, type DeliveryStatus } from "./delivery.js";
import { scopedRead } from "../../shared/db.js";
import { eq, and, desc } from "drizzle-orm";

const RESOURCE = "webhook";

/**
 * SSRF guard: block private, loopback, and link-local IP ranges in webhook URLs.
 * H6 FIX: resolves hostnames via DNS to detect rebinding attacks.
 * Extracted into shared/ssrf-guard.ts so there is ONE implementation shared with
 * integration-settings. Re-exported here for the delivery consumer and tests.
 */
import { isBlockedAfterResolve, isBlockedUrl, isPrivateIp } from "../../shared/ssrf-guard.js";

// Re-export for the delivery consumer (re-check at send time) and tests.
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
const replayParam = z.object({ id: z.string().uuid(), deliveryId: z.string().uuid() });
const rotationIdParam = z.object({ rotationId: z.string().uuid() });
const rotateBody = z.object({ reason: z.string().max(500).optional() });
const decisionBody = z.object({ decision: z.enum(["approve", "reject"]) });
const rotationListQuery = z.object({ status: z.enum(["pending", "approved", "rejected"]).optional() });

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
    const sanitized = rows.map(({ secret, previousSecret, ...rest }) => ({ ...rest, secretMasked: `${secret.slice(0, 10)}...` }));
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
    // SSRF FIX: re-check with DNS resolution whenever `url` changes (defeats
    // register-benign-then-rebind-to-metadata attacks on the update path).
    if (body.url !== undefined && (await isBlockedAfterResolve(body.url))) {
      throw new HttpError(422, "SSRF_BLOCKED", "URL resolves to a private/loopback/link-local address");
    }
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

  // CAP-054 REPLAY a past delivery
  app.post("/v1/admin/webhooks/:id/deliveries/:deliveryId/replay", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, [...TENANT_ADMIN_ROLES]);
    const { id, deliveryId } = safeParse(replayParam, req.params);
    const rows = await scopedRead((tx) => tx.select().from(webhookDeliveries)
      .where(and(eq(webhookDeliveries.id, deliveryId), eq(webhookDeliveries.tenantId, ctx.tenantId)))
      .limit(1));
    const row = rows[0];
    if (!row || row.webhookId !== id) throw new HttpError(404, "NOT_FOUND", "delivery not found");
    if (!canReplay(row.status as DeliveryStatus)) {
      throw new HttpError(409, "NOT_REPLAYABLE", `delivery in status ${row.status} cannot be replayed`);
    }
    const result = await commands.webhookReplay(ctx, id, deliveryId);
    return reply.code(202).send(result);
  });

  // CAP-054 secret rotation — MAKER: request a rotation
  app.post("/v1/admin/webhooks/:id/rotate-secret", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, [...TENANT_ADMIN_ROLES]);
    const { id } = safeParse(idParam, req.params);
    const body = safeParse(rotateBody, req.body ?? {});
    const wh = await scopedRead((tx) => tx.select().from(webhooks)
      .where(and(eq(webhooks.id, id), eq(webhooks.tenantId, ctx.tenantId))).limit(1));
    if (!wh[0]) throw new HttpError(404, "NOT_FOUND", "webhook not found");
    const result = await commands.webhookRotateRequest(ctx, id, body.reason);
    return reply.code(202).send(result);
  });

  // CAP-054 secret rotation — list rotation requests
  app.get("/v1/admin/webhooks/rotations", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, [...TENANT_ADMIN_ROLES]);
    const q = safeParse(rotationListQuery, req.query ?? {});
    const rows = await scopedRead((tx) => {
      const base = tx.select({
        id: secretRotations.id, webhookId: secretRotations.webhookId,
        status: secretRotations.status, reason: secretRotations.reason,
        requestedBy: secretRotations.requestedBy, requestedAt: secretRotations.requestedAt,
        decidedBy: secretRotations.decidedBy, decidedAt: secretRotations.decidedAt,
      }).from(secretRotations);
      return q.status
        ? base.where(and(eq(secretRotations.tenantId, ctx.tenantId), eq(secretRotations.status, q.status)))
        : base.where(eq(secretRotations.tenantId, ctx.tenantId));
    });
    return reply.send({ data: rows });
  });

  // CAP-054 secret rotation — CHECKER: approve/reject (maker != checker enforced)
  app.post("/v1/admin/webhooks/rotations/:rotationId/decision", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, [...TENANT_ADMIN_ROLES]);
    const { rotationId } = safeParse(rotationIdParam, req.params);
    const body = safeParse(decisionBody, req.body);
    const rows = await scopedRead((tx) => tx.select().from(secretRotations)
      .where(and(eq(secretRotations.id, rotationId), eq(secretRotations.tenantId, ctx.tenantId))).limit(1));
    const rot = rows[0];
    if (!rot) throw new HttpError(404, "NOT_FOUND", "rotation not found");
    if (rot.status !== "pending") throw new HttpError(409, "NOT_PENDING", `rotation is already ${rot.status}`);
    // Maker-checker: the approver must differ from the requester.
    if (rot.requestedBy === ctx.actorId) {
      throw new HttpError(409, "MAKER_CHECKER", "the approver must be different from the requester");
    }
    const result = await commands.webhookRotateDecide(ctx, rotationId, body.decision);
    return reply.code(202).send(result);
  });
}
