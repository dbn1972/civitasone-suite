/**
 * QP-001 — product/service catalogue classification: code, category, tax rate.
 *
 * The three columns live on catalogue.products (migration 0005), so they are
 * already returned by the existing read paths (GET /v1/catalogue/products and
 * GET /v1/catalogue/products/:id) with no change to those handlers. This file
 * adds the write + code-lookup surface without touching products/routes.ts.
 *
 * TAX RULE: `taxRateBps` is an INTEGER number of basis points (1200 = 12.00%).
 * Never a float — a percentage held as a float drifts under arithmetic.
 */
import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { resolveContext, requireRole, HttpError } from "../../shared/context.js";
import { db } from "../../shared/db.js";
import { enqueue } from "../../shared/outbox.js";
import { EVENTS } from "../../topics.js";
import * as repo from "./repo.js";
import * as classificationRepo from "./classification-repo.js";

const READ_ROLES = ["catalogue_user", "catalogue_admin", "catalogue_approver", "super_admin"];
const WRITE_ROLES = ["catalogue_admin", "super_admin"];

/** 10000 bps = 100%. A tax rate above 100% is a data-entry error. */
export const MAX_TAX_RATE_BPS = 10000;

const idParam = z.object({ id: z.string().uuid() });
const codeParam = z.object({ productCode: z.string().min(1).max(64) });

const putBody = z.object({
  productCode: z.string().min(1).max(64).regex(/^[A-Za-z0-9][A-Za-z0-9._-]*$/, "productCode must be alphanumeric with . _ - separators"),
  category: z.string().min(1).max(100),
  taxRateBps: z.number().int().min(0).max(MAX_TAX_RATE_BPS),
  /** Optional optimistic-lock guard. Falls back to the row's current version. */
  version: z.number().int().positive().optional(),
});

export async function productClassificationRoutes(app: FastifyInstance): Promise<void> {
  // ─── Lookup by catalogue code ────────────────────────────────────────────────
  app.get("/v1/catalogue/products/by-code/:productCode", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, READ_ROLES);
    const { productCode } = codeParam.parse(req.params);

    const product = await classificationRepo.findByProductCode(productCode, ctx.tenantId);
    if (!product) throw new HttpError(404, "NOT_FOUND", "No product with that code");

    return reply.send({ data: product });
  });

  // ─── Read classification ─────────────────────────────────────────────────────
  app.get("/v1/catalogue/products/:id/classification", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, READ_ROLES);
    const { id } = idParam.parse(req.params);

    const product = await repo.findById(id, ctx.tenantId);
    if (!product) throw new HttpError(404, "NOT_FOUND", "Product not found");

    return reply.send({
      data: {
        productId: product.id,
        productCode: product.productCode,
        category: product.category,
        taxRateBps: product.taxRateBps,
        version: product.version,
      },
    });
  });

  // ─── Set classification ──────────────────────────────────────────────────────
  app.put("/v1/catalogue/products/:id/classification", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, WRITE_ROLES);
    const { id } = idParam.parse(req.params);
    const body = putBody.parse(req.body);

    const product = await repo.findById(id, ctx.tenantId);
    if (!product) throw new HttpError(404, "NOT_FOUND", "Product not found");

    // product_code is unique per tenant (index in 0005). Check up-front so the
    // caller gets a 422 with a useful message instead of a raw constraint error.
    const clash = await classificationRepo.findByProductCode(body.productCode, ctx.tenantId);
    if (clash && clash.id !== id) {
      throw new HttpError(422, "DUPLICATE_PRODUCT_CODE", `productCode '${body.productCode}' is already used by another product`);
    }

    const expectedVersion = body.version ?? product.version;

    await db.transaction(async (tx) => {
      const ok = await repo.updateProduct(tx, id, ctx.tenantId, {
        productCode: body.productCode,
        category: body.category,
        taxRateBps: body.taxRateBps,
        updatedBy: ctx.actorId,
      }, expectedVersion);
      if (!ok) throw new HttpError(409, "VERSION_CONFLICT", "Product has been modified; retry with current version");

      await enqueue(tx, {
        topic: EVENTS.productClassified,
        eventType: EVENTS.productClassified,
        tenantId: ctx.tenantId,
        actorId: ctx.actorId,
        correlationId: ctx.correlationId,
        payload: {
          productId: id,
          productCode: body.productCode,
          category: body.category,
          taxRateBps: body.taxRateBps,
          previousVersion: expectedVersion,
        },
      });
    });

    return reply.send({
      data: {
        productId: id,
        productCode: body.productCode,
        category: body.category,
        taxRateBps: body.taxRateBps,
        version: expectedVersion + 1,
      },
    });
  });
}
