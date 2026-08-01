/**
 * PC-004 — circle/region/office availability flags on
 * catalogue.product_availability_v2, plus a most-specific-wins lookup.
 * The resolution rule itself lives in the pure availability-domain.ts.
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
import { resolveAvailability, type AvailabilityRule } from "./availability-domain.js";
import type { ProductAvailabilityV2Insert } from "./governance-schema.js";

const READ_ROLES = ["catalogue_user", "catalogue_admin", "catalogue_approver", "field_agent", "super_admin"];
const WRITE_ROLES = ["catalogue_admin", "super_admin"];

/** A single PUT may not rewrite more than this many rows (payload + lock bound). */
export const MAX_AVAILABILITY_ROWS = 500;

const idParam = z.object({ id: z.string().uuid() });

const availabilityRow = z.object({
  circleCode: z.string().min(1).max(50).nullable().optional(),
  regionCode: z.string().min(1).max(50).nullable().optional(),
  officeCode: z.string().min(1).max(50).nullable().optional(),
  available: z.boolean().default(true),
  effectiveFrom: z.string().datetime().optional(),
  effectiveTo: z.string().datetime().optional(),
});

const bulkSetBody = z.object({
  rows: z.array(availabilityRow).max(MAX_AVAILABILITY_ROWS),
});

const lookupQuery = z.object({
  productId: z.string().uuid(),
  circleId: z.string().min(1).max(50).optional(),
  regionId: z.string().min(1).max(50).optional(),
  officeId: z.string().min(1).max(50).optional(),
});

export async function availabilityV2Routes(app: FastifyInstance): Promise<void> {
  // ─── Most-specific-wins lookup ───────────────────────────────────────────────
  // Registered first so `/availability/lookup` is never captured by a
  // parameterised sibling route.
  app.get("/v1/catalogue/availability/lookup", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, READ_ROLES);
    const q = lookupQuery.parse(req.query);

    const product = await productRepo.findById(q.productId, ctx.tenantId);
    if (!product) throw new HttpError(404, "NOT_FOUND", "Product not found");

    const rows = await repo.listAvailabilityV2(q.productId, ctx.tenantId);
    const rules: AvailabilityRule[] = rows.map((r) => ({
      circleCode: r.circleCode,
      regionCode: r.regionCode,
      officeCode: r.officeCode,
      available: r.available,
      effectiveFrom: r.effectiveFrom,
      effectiveTo: r.effectiveTo,
    }));

    const resolution = resolveAvailability(rules, {
      ...(q.circleId !== undefined ? { circleCode: q.circleId } : {}),
      ...(q.regionId !== undefined ? { regionCode: q.regionId } : {}),
      ...(q.officeId !== undefined ? { officeCode: q.officeId } : {}),
    });

    return reply.send({
      data: {
        productId: q.productId,
        available: resolution.available,
        matchedRule: resolution.matchedRule,
        specificity: resolution.specificity,
        candidateCount: resolution.candidateCount,
        query: {
          circleId: q.circleId ?? null,
          regionId: q.regionId ?? null,
          officeId: q.officeId ?? null,
        },
      },
    });
  });

  // ─── List availability rows ──────────────────────────────────────────────────
  app.get("/v1/catalogue/products/:id/availability-v2", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, READ_ROLES);
    const { id } = idParam.parse(req.params);

    const product = await productRepo.findById(id, ctx.tenantId);
    if (!product) throw new HttpError(404, "NOT_FOUND", "Product not found");

    const rows = await repo.listAvailabilityV2(id, ctx.tenantId);
    return reply.send({ data: rows, meta: { page: 1, pageSize: rows.length, total: rows.length } });
  });

  // ─── Bulk set availability (full replace for this product) ───────────────────
  app.put("/v1/catalogue/products/:id/availability-v2", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, WRITE_ROLES);
    const { id } = idParam.parse(req.params);
    const body = bulkSetBody.parse(req.body);

    const product = await productRepo.findById(id, ctx.tenantId);
    if (!product) throw new HttpError(404, "NOT_FOUND", "Product not found");

    // A row cannot name a narrower level without its broader one — an office row
    // with no region is unresolvable against a region-scoped query.
    for (const row of body.rows) {
      const circle = row.circleCode ?? null;
      const region = row.regionCode ?? null;
      const office = row.officeCode ?? null;
      if (office !== null && region === null) {
        throw new HttpError(422, "INVALID_AVAILABILITY_SCOPE", "officeCode requires regionCode on the same row");
      }
      if (region !== null && circle === null) {
        throw new HttpError(422, "INVALID_AVAILABILITY_SCOPE", "regionCode requires circleCode on the same row");
      }
      if (row.effectiveFrom !== undefined && row.effectiveTo !== undefined
        && new Date(row.effectiveTo).getTime() < new Date(row.effectiveFrom).getTime()) {
        throw new HttpError(422, "INVALID_EFFECTIVE_WINDOW", "effectiveTo must not precede effectiveFrom");
      }
    }

    const now = new Date();
    const inserts: ProductAvailabilityV2Insert[] = body.rows.map((row) => ({
      id: randomUUID(),
      tenantId: ctx.tenantId,
      productId: id,
      circleCode: row.circleCode ?? null,
      regionCode: row.regionCode ?? null,
      officeCode: row.officeCode ?? null,
      available: row.available,
      effectiveFrom: row.effectiveFrom !== undefined ? new Date(row.effectiveFrom) : now,
      effectiveTo: row.effectiveTo !== undefined ? new Date(row.effectiveTo) : null,
      createdBy: ctx.actorId,
      updatedBy: ctx.actorId,
      version: 1,
    }));

    await db.transaction(async (tx) => {
      const written = await repo.replaceAvailabilityV2(tx, id, ctx.tenantId, inserts);

      await enqueue(tx, {
        topic: EVENTS.productAvailabilityChanged,
        eventType: EVENTS.productAvailabilityChanged,
        tenantId: ctx.tenantId,
        actorId: ctx.actorId,
        correlationId: ctx.correlationId,
        payload: { productId: id, rowCount: written },
      });
    });

    return reply.code(202).send({ data: { productId: id, rowCount: inserts.length } });
  });
}
