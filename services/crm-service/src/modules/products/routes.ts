/**
 * Product catalogue routes (QP-001). Writes are async-CQRS (202 → consumer). Reads are
 * synchronous. price_minor is bigint MINOR units carried as a STRING.
 */
import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { resolveContext, requireRole, HttpError } from "../../shared/context.js";
import { commandId } from "../../shared/idempotency.js";
import { queue } from "../../shared/infra.js";
import { COMMANDS } from "../../topics.js";
import * as repo from "./repo.js";

const CRM_ROLES = ["crm_user", "crm_admin", "super_admin", "tenant_admin"];
const ADMIN_ROLES = ["crm_admin", "super_admin", "tenant_admin"];

const idParam = z.object({ id: z.string().uuid() });
const minor = z.string().regex(/^\d{1,25}$/, "must be a non-negative integer string of minor units");
const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);

const createBody = z.object({
  category: z.string().min(1).max(120).optional(),
  code: z.string().min(1).max(64),
  name: z.string().min(1).max(200),
  unit: z.string().min(1).max(32).default("unit"),
  taxRateBps: z.number().int().min(0).max(100000).default(0),
  priceMinor: minor.default("0"),
  currency: z.string().length(3).default("INR"),
  activeFrom: isoDate.nullable().optional(),
  activeTo: isoDate.nullable().optional(),
  enabled: z.boolean().default(true),
});

const updateBody = z.object({
  category: z.string().min(1).max(120).nullable().optional(),
  name: z.string().min(1).max(200).optional(),
  unit: z.string().min(1).max(32).optional(),
  taxRateBps: z.number().int().min(0).max(100000).optional(),
  priceMinor: minor.optional(),
  currency: z.string().length(3).optional(),
  activeFrom: isoDate.nullable().optional(),
  activeTo: isoDate.nullable().optional(),
  enabled: z.boolean().optional(),
}).refine((b) => Object.keys(b).length > 0, { message: "at least one field required" });

const listQuery = z.object({
  limit: z.coerce.number().int().min(1).max(200).default(50),
  offset: z.coerce.number().int().min(0).default(0),
  activeOnly: z.coerce.boolean().default(false),
  category: z.string().min(1).max(120).optional(),
});

export async function productRoutes(app: FastifyInstance): Promise<void> {
  app.post("/v1/crm/products", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, ADMIN_ROLES);
    const body = createBody.parse(req.body);
    const existing = await repo.findByCode(ctx.tenantId, body.code);
    if (existing) throw new HttpError(409, "PRODUCT_EXISTS", "a product with this code already exists");
    const id = commandId(ctx, `${COMMANDS.createProduct}:${body.code}`);
    await queue.publish(COMMANDS.createProduct, {
      messageId: id, type: COMMANDS.createProduct, tenantId: ctx.tenantId, actorId: ctx.actorId,
      correlationId: ctx.correlationId, schemaVersion: "1.0",
      payload: { id, tenantId: ctx.tenantId, ...body, priceMinor: BigInt(body.priceMinor).toString() },
    });
    return reply.code(202).send({ id, status: "accepted", correlationId: ctx.correlationId });
  });

  app.get("/v1/crm/products", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, CRM_ROLES);
    const q = listQuery.parse(req.query ?? {});
    const { rows, total } = await repo.list(ctx.tenantId, {
      limit: q.limit, offset: q.offset, activeOnly: q.activeOnly, ...(q.category ? { category: q.category } : {}),
    });
    return reply.send({ data: rows, meta: { limit: q.limit, offset: q.offset, total } });
  });

  app.get("/v1/crm/products/:id", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, CRM_ROLES);
    const { id } = idParam.parse(req.params);
    const product = await repo.findById(ctx.tenantId, id);
    if (!product) throw new HttpError(404, "NOT_FOUND", "product not found");
    return reply.send({ data: product });
  });

  app.patch("/v1/crm/products/:id", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, ADMIN_ROLES);
    const { id } = idParam.parse(req.params);
    const body = updateBody.parse(req.body);
    const existing = await repo.findById(ctx.tenantId, id);
    if (!existing) throw new HttpError(404, "NOT_FOUND", "product not found");
    const msgId = commandId(ctx, `${COMMANDS.updateProduct}:${id}`);
    await queue.publish(COMMANDS.updateProduct, {
      messageId: msgId, type: COMMANDS.updateProduct, tenantId: ctx.tenantId, actorId: ctx.actorId,
      correlationId: ctx.correlationId, schemaVersion: "1.0",
      payload: { id, tenantId: ctx.tenantId, ...body, ...(body.priceMinor !== undefined ? { priceMinor: BigInt(body.priceMinor).toString() } : {}) },
    });
    return reply.code(202).send({ id, status: "accepted", correlationId: ctx.correlationId });
  });

  app.delete("/v1/crm/products/:id", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, ADMIN_ROLES);
    const { id } = idParam.parse(req.params);
    const msgId = commandId(ctx, `${COMMANDS.deleteProduct}:${id}`);
    await queue.publish(COMMANDS.deleteProduct, {
      messageId: msgId, type: COMMANDS.deleteProduct, tenantId: ctx.tenantId, actorId: ctx.actorId,
      correlationId: ctx.correlationId, schemaVersion: "1.0",
      payload: { id, tenantId: ctx.tenantId },
    });
    return reply.code(202).send({ id: msgId, status: "accepted", correlationId: ctx.correlationId });
  });
}
