/**
 * QP-001 — product/service catalogue classification: code, category, tax rate.
 * Mutations publish commands and return 202 Accepted.
 */
import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { resolveContext, requireRole, HttpError } from "../../shared/context.js";
import * as repo from "./repo.js";
import * as classificationRepo from "./classification-repo.js";
import * as commands from "./commands.js";

const READ_ROLES = ["catalogue_user", "catalogue_admin", "catalogue_approver", "super_admin"];
const WRITE_ROLES = ["catalogue_admin", "super_admin"];
export const MAX_TAX_RATE_BPS = 10000;

const idParam = z.object({ id: z.string().uuid() });
const codeParam = z.object({ productCode: z.string().min(1).max(64) });
const putBody = z.object({
  productCode: z.string().min(1).max(64).regex(/^[A-Za-z0-9][A-Za-z0-9._-]*$/, "productCode must be alphanumeric with . _ - separators"),
  category: z.string().min(1).max(100),
  taxRateBps: z.number().int().min(0).max(MAX_TAX_RATE_BPS),
  version: z.number().int().positive().optional(),
});

export async function productClassificationRoutes(app: FastifyInstance): Promise<void> {
  app.get("/v1/catalogue/products/by-code/:productCode", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, READ_ROLES);
    const { productCode } = codeParam.parse(req.params);
    const product = await classificationRepo.findByProductCode(productCode, ctx.tenantId);
    if (!product) throw new HttpError(404, "NOT_FOUND", "No product with that code");
    return reply.send({ data: product });
  });

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

  app.put("/v1/catalogue/products/:id/classification", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, WRITE_ROLES);
    const { id } = idParam.parse(req.params);
    const body = putBody.parse(req.body);
    const product = await repo.findById(id, ctx.tenantId);
    if (!product) throw new HttpError(404, "NOT_FOUND", "Product not found");
    const clash = await classificationRepo.findByProductCode(body.productCode, ctx.tenantId);
    if (clash && clash.id !== id) {
      throw new HttpError(422, "DUPLICATE_PRODUCT_CODE", `productCode '${body.productCode}' is already used by another product`);
    }
    if (body.version !== undefined && body.version !== product.version) {
      throw new HttpError(409, "VERSION_CONFLICT", "Product has been modified; retry with current version");
    }
    const expectedVersion = body.version ?? product.version;
    return reply.code(202).send(
      await commands.classifyProduct(ctx, id, {
        productCode: body.productCode,
        category: body.category,
        taxRateBps: body.taxRateBps,
        version: expectedVersion,
      }),
    );
  });
}
