import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { resolveContext, requireRole, HttpError } from "../../shared/context.js";
import { cache } from "../../shared/infra.js";
import * as repo from "./repo.js";
import * as commands from "./commands.js";

const SHOP_ROLES = ["shop_user", "shop_admin", "super_admin"];
// NOTE: this module only has applicant-initiated self-service actions
// (create/list/get/submit/withdraw/fee-payment) — none of them are officer-only,
// so there is no ADMIN_ROLES-gated route here. Officer/decision actions live in
// the approvals, permits, and lifecycle modules, which each define and use their
// own narrower OFFICER_ROLES.

// employeeCount / capacityDetails.areaSqft feed unbounded into
// domain.ts's calculateFeeMinor (`BigInt(input.employeeCount - 20)`,
// `BigInt(Math.floor((input.areaSqft - 500) / 100))`) before landing in
// shop.applications.employee_count (migrations/0001_initial.sql: plain
// `integer` — int4, max 2_147_483_647) and .capacity_details (jsonb, no
// fixed numeric precision). Previously validated only as
// nonnegative/int, with no upper bound — a value that clears Zod (a JS
// number can represent integers far past int4) but exceeds int4 range
// sails past validation and hits the DB inside the async consumer's
// transaction as a raw "integer out of range" 500 far from the request,
// after the 202 has already been returned. The .max() ceilings below are
// generous real-world limits for a shop/establishment permit (the
// largest Indian malls/factories run to a few million sqft and a few
// thousand staff, not billions) — comfortably inside employee_count's
// int4 range and nowhere near overflowing fee_amount_minor's bigint
// (+-~9.2e18) through calculateFeeMinor's arithmetic.
const MAX_EMPLOYEE_COUNT = 50_000;
const MAX_AREA_SQFT = 10_000_000;

const createBody = z.object({
  establishmentName: z.string().min(1).max(256),
  establishmentType: z.string().min(1).max(64),
  ownerName: z.string().min(1).max(256),
  ownerType: z.string().min(1).max(32),
  premisesAddress: z.object({
    line1: z.string().min(1),
    line2: z.string().optional(),
    city: z.string().min(1),
    pin: z.string().min(6).max(6),
    ward: z.string().optional(),
    zone: z.string().optional(),
  }),
  premisesPropertyId: z.string().uuid().optional(),
  activityDescription: z.string().optional(),
  activityCategory: z.string().min(1).max(64),
  employeeCount: z.number().int().nonnegative().max(MAX_EMPLOYEE_COUNT).optional(),
  capacityDetails: z.object({
    seating: z.number().int().nonnegative().optional(),
    areaSqft: z.number().nonnegative().max(MAX_AREA_SQFT).optional(),
    floors: z.number().int().nonnegative().optional(),
  }).optional(),
  documents: z.array(z.object({
    docType: z.string(),
    fileId: z.string().uuid(),
    uploadedAt: z.string().datetime(),
  })).optional(),
});

const listQuery = z.object({
  status: z.string().optional(),
  page: z.coerce.number().int().positive().optional(),
  pageSize: z.coerce.number().int().positive().max(100).optional(),
});

const idParam = z.object({ id: z.string().uuid() });

const feePaymentBody = z.object({
  transactionId: z.string().min(1).max(128),
});

export async function registrationRoutes(app: FastifyInstance): Promise<void> {
  app.post("/v1/shop/applications", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, SHOP_ROLES);
    const body = createBody.parse(req.body);
    return reply.code(202).send(await commands.createApplication(ctx, body));
  });

  app.get("/v1/shop/applications", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, SHOP_ROLES);
    const q = listQuery.parse(req.query);
    const { rows, total } = await repo.list(ctx.tenantId, q);
    return reply.send({
      data: rows,
      meta: { page: q.page ?? 1, pageSize: q.pageSize ?? 20, total },
    });
  });

  app.get("/v1/shop/applications/:id", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, SHOP_ROLES);
    const { id } = idParam.parse(req.params);
    const cacheKey = `shop:${ctx.tenantId}:application:${id}`;
    const row = await cache.getOrLoad(cacheKey, () => repo.findById(id, ctx.tenantId));
    if (!row) throw new HttpError(404, "APPLICATION_NOT_FOUND", "Application not found");
    return reply.send({ data: row });
  });

  app.post("/v1/shop/applications/:id/submit", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, SHOP_ROLES);
    const { id } = idParam.parse(req.params);
    const existing = await repo.findById(id, ctx.tenantId);
    if (!existing) throw new HttpError(404, "APPLICATION_NOT_FOUND", "Application not found");
    if (existing.status !== "draft") {
      throw new HttpError(422, "INVALID_STATUS", `Cannot submit application in status '${existing.status}'`);
    }
    return reply.code(202).send(await commands.submitApplication(ctx, id));
  });

  app.post("/v1/shop/applications/:id/withdraw", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, SHOP_ROLES);
    const { id } = idParam.parse(req.params);
    const existing = await repo.findById(id, ctx.tenantId);
    if (!existing) throw new HttpError(404, "APPLICATION_NOT_FOUND", "Application not found");
    if (!["draft", "submitted"].includes(existing.status)) {
      throw new HttpError(422, "INVALID_STATUS", `Cannot withdraw application in status '${existing.status}'`);
    }
    return reply.code(202).send(await commands.withdrawApplication(ctx, id));
  });

  app.post("/v1/shop/applications/:id/fee-payment", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, SHOP_ROLES);
    const { id } = idParam.parse(req.params);
    const body = feePaymentBody.parse(req.body);
    const existing = await repo.findById(id, ctx.tenantId);
    if (!existing) throw new HttpError(404, "APPLICATION_NOT_FOUND", "Application not found");
    if (existing.feePaid) throw new HttpError(409, "FEE_ALREADY_PAID", "Fee has already been paid");
    return reply.code(202).send(await commands.recordFeePayment(ctx, id, body.transactionId));
  });
}
