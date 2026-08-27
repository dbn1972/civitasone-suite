import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { resolveContext, requireRole, HttpError } from "../../shared/context.js";
import { cache } from "../../shared/infra.js";
import * as repo from "./repo.js";
import * as propertiesRepo from "../properties/repo.js";
import * as commands from "./commands.js";
import { canTransition } from "./domain.js";

const USER_ROLES = ["market_user", "market_admin", "super_admin"];
const ADMIN_ROLES = ["market_admin", "super_admin"];

const applyBody = z.object({
  propertyId: z.string().uuid(),
  allotteeName: z.string().min(1).max(256),
  allotteePhone: z.string().max(20).optional(),
  allotteeAadhaar: z.string().length(12).optional(),
  allotmentType: z.enum(["draw", "auction", "committee", "direct"]),
  monthlyRentMinor: z.number().int().nonnegative().optional(),
  securityDepositMinor: z.number().int().nonnegative().optional(),
});

const signBody = z.object({
  agreementStartDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  agreementEndDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
});

const listQuery = z.object({
  status: z.string().optional(),
  propertyId: z.string().uuid().optional(),
  page: z.coerce.number().int().positive().optional(),
  pageSize: z.coerce.number().int().positive().max(100).optional(),
});

const idParam = z.object({ id: z.string().uuid() });

export async function allotmentRoutes(app: FastifyInstance): Promise<void> {
  app.post("/v1/market/allotments", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, USER_ROLES);
    const body = applyBody.parse(req.body);
    // propertyId previously had zero existence/tenant-match/status check (no
    // FK either) — an allotment could be created against a nonexistent
    // property, a different tenant's property, or one under_maintenance.
    const property = await propertiesRepo.findById(body.propertyId, ctx.tenantId);
    if (!property) throw new HttpError(404, "PROPERTY_NOT_FOUND", "Property not found");
    if (property.status !== "available") {
      throw new HttpError(422, "PROPERTY_NOT_AVAILABLE", `Property is in status '${property.status}', not available for allotment`);
    }
    // BigInt conversion removed here too — see properties/routes.ts for why
    // (crashes the async consumer's JSON.stringify on a real queue driver).
    return reply.code(202).send(await commands.applyAllotment(ctx, body));
  });

  app.get("/v1/market/allotments", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, USER_ROLES);
    const q = listQuery.parse(req.query);
    const { rows, total } = await repo.list(ctx.tenantId, q);
    return reply.send({
      data: rows,
      meta: { page: q.page ?? 1, pageSize: q.pageSize ?? 20, total },
    });
  });

  app.get("/v1/market/allotments/:id", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, USER_ROLES);
    const { id } = idParam.parse(req.params);
    const cacheKey = `market:${ctx.tenantId}:allotment:${id}`;
    const row = await cache.getOrLoad(cacheKey, () => repo.findById(id, ctx.tenantId));
    if (!row) throw new HttpError(404, "ALLOTMENT_NOT_FOUND", "Allotment not found");
    return reply.send({ data: row });
  });

  app.post("/v1/market/allotments/:id/select", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, ADMIN_ROLES);
    const { id } = idParam.parse(req.params);
    const existing = await repo.findById(id, ctx.tenantId);
    if (!existing) throw new HttpError(404, "ALLOTMENT_NOT_FOUND", "Allotment not found");
    if (!canTransition(existing.status, "selected")) {
      throw new HttpError(422, "INVALID_STATUS", `Cannot select allottee in status '${existing.status}'`);
    }
    return reply.code(202).send(await commands.selectAllottee(ctx, id));
  });

  app.post("/v1/market/allotments/:id/sign-agreement", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, ADMIN_ROLES);
    const { id } = idParam.parse(req.params);
    const body = signBody.parse(req.body);
    const existing = await repo.findById(id, ctx.tenantId);
    if (!existing) throw new HttpError(404, "ALLOTMENT_NOT_FOUND", "Allotment not found");
    if (!canTransition(existing.status, "agreement_signed")) {
      throw new HttpError(422, "INVALID_STATUS", `Cannot sign agreement in status '${existing.status}'`);
    }
    return reply.code(202).send(await commands.signAgreement(ctx, id, body.agreementStartDate, body.agreementEndDate));
  });
}
