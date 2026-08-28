import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { hasAnyRole } from "@civitasone/auth";
import type { RequestContext } from "@civitasone/types";
import { resolveContext, requireRole, HttpError } from "../../shared/context.js";
import { cache } from "../../shared/infra.js";
import * as repo from "./repo.js";
import * as facilitiesRepo from "../facilities/repo.js";
import * as commands from "./commands.js";

const USER_ROLES = ["parking_user", "parking_admin", "super_admin"];
const ADMIN_ROLES = ["parking_admin", "super_admin"];

/** Same ownership pattern as bookings/routes.ts — see there for why. */
function requireOwnerOrAdmin(ctx: RequestContext, pass: { createdBy: string }): void {
  if (hasAnyRole(ctx, ADMIN_ROLES)) return;
  if (pass.createdBy !== ctx.actorId) {
    throw new HttpError(403, "FORBIDDEN", "Cannot access another user's pass");
  }
}

const createBody = z.object({
  facilityId: z.string().uuid(),
  holderName: z.string().min(1).max(256),
  vehicleNumber: z.string().min(1).max(20),
  vehicleType: z.enum(["two_wheeler", "car", "commercial"]),
  passType: z.enum(["monthly", "annual"]),
  validFrom: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  paymentRef: z.string().optional(),
});

const listQuery = z.object({
  status: z.string().optional(),
  facilityId: z.string().uuid().optional(),
  page: z.coerce.number().int().positive().optional(),
  pageSize: z.coerce.number().int().positive().max(100).optional(),
});

const idParam = z.object({ id: z.string().uuid() });

export async function passRoutes(app: FastifyInstance): Promise<void> {
  app.post("/v1/parking/passes", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, USER_ROLES);
    const body = createBody.parse(req.body);
    // facilityId previously had no existence check, and (separately) the
    // consumer used a hardcoded flat fee instead of the facility's real
    // monthlyPassMinor/annualPassMinor. Now that the consumer reads the real
    // tariff, reject synchronously here if the facility hasn't configured one
    // for the requested passType, rather than accepting a doomed-to-fail async
    // command (parking_passes.amount_minor is NOT NULL).
    const facility = await facilitiesRepo.findById(body.facilityId, ctx.tenantId);
    if (!facility) throw new HttpError(404, "FACILITY_NOT_FOUND", "Facility not found");
    const tariff = body.passType === "annual" ? facility.annualPassMinor : facility.monthlyPassMinor;
    if (tariff == null) {
      throw new HttpError(422, "TARIFF_NOT_CONFIGURED", `Facility has no ${body.passType} pass tariff configured`);
    }
    return reply.code(202).send(await commands.createPass(ctx, body));
  });

  app.get("/v1/parking/passes", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, USER_ROLES);
    const q = listQuery.parse(req.query);
    const scopedToSelf = hasAnyRole(ctx, ADMIN_ROLES) ? undefined : ctx.actorId;
    const { rows, total } = await repo.list(ctx.tenantId, { ...q, createdBy: scopedToSelf });
    return reply.send({
      data: rows,
      meta: { page: q.page ?? 1, pageSize: q.pageSize ?? 20, total },
    });
  });

  app.get("/v1/parking/passes/:id", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, USER_ROLES);
    const { id } = idParam.parse(req.params);
    const cacheKey = `parking:${ctx.tenantId}:pass:${id}`;
    const row = await cache.getOrLoad(cacheKey, () => repo.findById(id, ctx.tenantId));
    if (!row) throw new HttpError(404, "PASS_NOT_FOUND", "Pass not found");
    requireOwnerOrAdmin(ctx, row);
    return reply.send({ data: row });
  });

  app.post("/v1/parking/passes/:id/cancel", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, USER_ROLES);
    const { id } = idParam.parse(req.params);
    const existing = await repo.findById(id, ctx.tenantId);
    if (!existing) throw new HttpError(404, "PASS_NOT_FOUND", "Pass not found");
    requireOwnerOrAdmin(ctx, existing);
    if (existing.status !== "active") {
      throw new HttpError(422, "INVALID_STATUS", `Cannot cancel pass in status '${existing.status}'`);
    }
    return reply.code(202).send(await commands.cancelPass(ctx, id));
  });
}
