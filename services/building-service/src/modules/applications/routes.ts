import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { resolveContext, requireRole, HttpError } from "../../shared/context.js";
import { cache } from "../../shared/infra.js";
import * as repo from "./repo.js";
import * as commands from "./commands.js";

const BUILDING_ROLES = ["building_user", "building_admin", "super_admin"];

// plotArea/builtUpArea are stored in numeric(12,2) and fsiRequested in
// numeric(6,3) (migrations/0001_init.sql); proposedFloors is a plain
// integer. None of the four had an upper bound, so an oversized value would
// sail past validation and hit the DB inside the async consumer's
// transaction — either a raw "numeric field overflow" (values >= 10^10 for
// the (12,2) columns, >= 10^3 for the (6,3) column) surfacing as an
// unhandled 500 far from the request, or a value silently rounded to the
// column's scale (extra decimal digits beyond .2/.3) with no error at all.
// .max() below is each column's true representable ceiling (10^(precision
// - scale) - 10^-scale); .multipleOf() rejects finer-grained decimals than
// the column can store instead of letting Postgres round them away
// unnoticed. This also keeps domain.ts's calculateFeeMinor's BigInt
// arithmetic (builtUpArea, proposedFloors) comfortably inside fee_minor's
// bigint range (+-~9.2e18) with orders of magnitude to spare.
const MAX_AREA_NUMERIC_12_2 = 9_999_999_999.99; // precision 12, scale 2
const MAX_FSI_NUMERIC_6_3 = 999.999; // precision 6, scale 3
const MAX_PROPOSED_FLOORS = 250; // integer column; generous real-world ceiling — world's tallest structures are ~160-170 floors — well inside int32 and the BigInt fee-math's safe range

const createBody = z.object({
  siteAddress: z.object({
    line1: z.string().min(1),
    line2: z.string().optional(),
    city: z.string().min(1),
    pin: z.string().min(6).max(6),
    ward: z.string().optional(),
    zone: z.string().optional(),
    surveyNumber: z.string().optional(),
  }),
  plotArea: z.number().positive().max(MAX_AREA_NUMERIC_12_2).multipleOf(0.01).optional(),
  builtUpArea: z.number().positive().max(MAX_AREA_NUMERIC_12_2).multipleOf(0.01).optional(),
  proposedFloors: z.number().int().positive().max(MAX_PROPOSED_FLOORS).optional(),
  fsiRequested: z.number().positive().max(MAX_FSI_NUMERIC_6_3).multipleOf(0.001).optional(),
  architectName: z.string().max(256).optional(),
  architectLicenceNo: z.string().max(64).optional(),
  structuralEngineer: z.string().max(256).optional(),
  documents: z.array(z.object({ docType: z.string(), fileId: z.string().uuid(), uploadedAt: z.string().datetime() })).optional(),
  drawings: z.array(z.object({ drawingType: z.string(), fileId: z.string().uuid(), versionNumber: z.number().int().positive(), uploadedAt: z.string().datetime() })).optional(),
});

const listQuery = z.object({
  status: z.string().optional(),
  page: z.coerce.number().int().positive().optional(),
  pageSize: z.coerce.number().int().positive().max(100).optional(),
});

const idParam = z.object({ id: z.string().uuid() });
const feePaymentBody = z.object({ transactionId: z.string().min(1).max(128) });

export async function applicationRoutes(app: FastifyInstance): Promise<void> {
  app.post("/v1/building/applications", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, BUILDING_ROLES);
    const body = createBody.parse(req.body);
    return reply.code(202).send(await commands.createApplication(ctx, body));
  });

  app.get("/v1/building/applications", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, BUILDING_ROLES);
    const q = listQuery.parse(req.query);
    const { rows, total } = await repo.list(ctx.tenantId, q);
    return reply.send({ data: rows, meta: { page: q.page ?? 1, pageSize: q.pageSize ?? 20, total } });
  });

  app.get("/v1/building/applications/:id", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, BUILDING_ROLES);
    const { id } = idParam.parse(req.params);
    const cacheKey = cache.makeKey(ctx.tenantId, "application", id);
    const row = await cache.getOrLoad(cacheKey, () => repo.findById(id, ctx.tenantId));
    if (!row) throw new HttpError(404, "APPLICATION_NOT_FOUND", "Application not found");
    return reply.send({ data: row });
  });

  app.post("/v1/building/applications/:id/submit", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, BUILDING_ROLES);
    const { id } = idParam.parse(req.params);
    const existing = await repo.findById(id, ctx.tenantId);
    if (!existing) throw new HttpError(404, "APPLICATION_NOT_FOUND", "Application not found");
    if (existing.status !== "draft") throw new HttpError(422, "INVALID_STATUS", `Cannot submit application in status '${existing.status}'`);
    return reply.code(202).send(await commands.submitApplication(ctx, id));
  });

  app.post("/v1/building/applications/:id/withdraw", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, BUILDING_ROLES);
    const { id } = idParam.parse(req.params);
    const existing = await repo.findById(id, ctx.tenantId);
    if (!existing) throw new HttpError(404, "APPLICATION_NOT_FOUND", "Application not found");
    if (!["draft", "submitted"].includes(existing.status)) throw new HttpError(422, "INVALID_STATUS", `Cannot withdraw application in status '${existing.status}'`);
    return reply.code(202).send(await commands.withdrawApplication(ctx, id));
  });

  app.post("/v1/building/applications/:id/fee-payment", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, BUILDING_ROLES);
    const { id } = idParam.parse(req.params);
    const body = feePaymentBody.parse(req.body);
    const existing = await repo.findById(id, ctx.tenantId);
    if (!existing) throw new HttpError(404, "APPLICATION_NOT_FOUND", "Application not found");
    if (existing.feePaid) throw new HttpError(409, "FEE_ALREADY_PAID", "Fee has already been paid");
    return reply.code(202).send(await commands.recordFeePayment(ctx, id, body.transactionId));
  });
}
