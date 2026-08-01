/**
 * PC-003 — regulatory metadata per product, on catalogue.regulatory_metadata.
 * One record per product per tenant (UNIQUE index added in migration 0005), so
 * PUT is a genuine upsert rather than an append.
 */
import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { randomUUID } from "node:crypto";
import { resolveContext, requireRole, HttpError } from "../../shared/context.js";
import { db } from "../../shared/db.js";
import { enqueue } from "../../shared/outbox.js";
import { EVENTS } from "../../topics.js";
import * as productRepo from "./repo.js";
import * as repo from "./governance-repo.js";
import { COMPLIANCE_STATUSES } from "./governance-schema.js";

const READ_ROLES = ["catalogue_user", "catalogue_admin", "catalogue_approver", "compliance_officer", "super_admin"];
const WRITE_ROLES = ["catalogue_admin", "compliance_officer", "super_admin"];

const idParam = z.object({ id: z.string().uuid() });

const upsertBody = z.object({
  regulation: z.string().min(1).max(200),
  complianceStatus: z.enum(COMPLIANCE_STATUSES).default("pending_review"),
  notes: z.string().max(4000).optional(),
  validFrom: z.string().datetime().optional(),
  validUntil: z.string().datetime().optional(),
  reviewedAt: z.string().datetime().optional(),
  /** Optional optimistic-lock guard. Falls back to the row's current version. */
  version: z.number().int().positive().optional(),
});

const expiringQuery = z.object({
  withinDays: z.coerce.number().int().min(1).max(3650).default(30),
  limit: z.coerce.number().int().min(1).max(200).default(50),
  offset: z.coerce.number().int().min(0).default(0),
});

export async function regulatoryRoutes(app: FastifyInstance): Promise<void> {
  // ─── Expiring regulatory validity ────────────────────────────────────────────
  // Registered before the parameterised product route so `/regulatory/expiring`
  // is never captured as a product id.
  app.get("/v1/catalogue/regulatory/expiring", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, READ_ROLES);
    const q = expiringQuery.parse(req.query);

    const cutoff = new Date(Date.now() + q.withinDays * 24 * 60 * 60 * 1000);
    const { rows, total } = await repo.listExpiringRegulatory(ctx.tenantId, cutoff, q.limit, q.offset);
    const page = Math.floor(q.offset / q.limit) + 1;

    return reply.send({
      data: rows,
      meta: { page, pageSize: q.limit, total, withinDays: q.withinDays, cutoff: cutoff.toISOString() },
    });
  });

  // ─── Read a product's regulatory record ──────────────────────────────────────
  app.get("/v1/catalogue/products/:id/regulatory", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, READ_ROLES);
    const { id } = idParam.parse(req.params);

    const product = await productRepo.findById(id, ctx.tenantId);
    if (!product) throw new HttpError(404, "NOT_FOUND", "Product not found");

    const row = await repo.findRegulatory(id, ctx.tenantId);
    if (!row) throw new HttpError(404, "NOT_FOUND", "No regulatory metadata recorded for this product");

    return reply.send({ data: row });
  });

  // ─── Upsert a product's regulatory record ────────────────────────────────────
  app.put("/v1/catalogue/products/:id/regulatory", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, WRITE_ROLES);
    const { id } = idParam.parse(req.params);
    const body = upsertBody.parse(req.body);

    const product = await productRepo.findById(id, ctx.tenantId);
    if (!product) throw new HttpError(404, "NOT_FOUND", "Product not found");

    const validFrom = body.validFrom !== undefined ? new Date(body.validFrom) : null;
    const validUntil = body.validUntil !== undefined ? new Date(body.validUntil) : null;
    if (validFrom !== null && validUntil !== null && validUntil.getTime() < validFrom.getTime()) {
      throw new HttpError(422, "INVALID_VALIDITY_WINDOW", "validUntil must not precede validFrom");
    }

    const existing = await repo.findRegulatory(id, ctx.tenantId);
    const rowId = existing?.id ?? randomUUID();
    const created = existing === null;

    await db.transaction(async (tx) => {
      if (existing === null) {
        await repo.insertRegulatory(tx, {
          id: rowId,
          tenantId: ctx.tenantId,
          productId: id,
          regulation: body.regulation,
          complianceStatus: body.complianceStatus,
          notes: body.notes ?? null,
          validFrom,
          validUntil,
          reviewedAt: body.reviewedAt !== undefined ? new Date(body.reviewedAt) : null,
          reviewerId: ctx.actorId,
          createdBy: ctx.actorId,
          updatedBy: ctx.actorId,
          version: 1,
        });
      } else {
        const expectedVersion = body.version ?? existing.version;
        const ok = await repo.updateRegulatory(tx, id, ctx.tenantId, {
          regulation: body.regulation,
          complianceStatus: body.complianceStatus,
          notes: body.notes ?? null,
          validFrom,
          validUntil,
          reviewedAt: body.reviewedAt !== undefined ? new Date(body.reviewedAt) : null,
          reviewerId: ctx.actorId,
          updatedBy: ctx.actorId,
        }, expectedVersion);
        if (!ok) {
          throw new HttpError(409, "VERSION_CONFLICT", "Regulatory metadata has been modified; retry with current version");
        }
      }

      await enqueue(tx, {
        topic: EVENTS.regulatoryMetadataUpserted,
        eventType: EVENTS.regulatoryMetadataUpserted,
        tenantId: ctx.tenantId,
        actorId: ctx.actorId,
        correlationId: ctx.correlationId,
        payload: {
          productId: id,
          regulatoryId: rowId,
          regulation: body.regulation,
          complianceStatus: body.complianceStatus,
          created,
          validUntil: validUntil?.toISOString() ?? null,
        },
      });
    });

    return reply.code(created ? 201 : 200).send({ data: { id: rowId, productId: id, created } });
  });
}
