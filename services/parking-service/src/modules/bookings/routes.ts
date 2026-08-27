import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { hasAnyRole } from "@civitasone/auth";
import type { RequestContext } from "@civitasone/types";
import { resolveContext, requireRole, HttpError } from "../../shared/context.js";
import { cache } from "../../shared/infra.js";
import * as repo from "./repo.js";
import * as facilitiesRepo from "../facilities/repo.js";
import * as commands from "./commands.js";
import { canTransition } from "./domain.js";

const USER_ROLES = ["parking_user", "parking_admin", "super_admin"];
const ADMIN_ROLES = ["parking_admin", "super_admin"];

/**
 * Previously NOTHING compared caller identity to the booking at all — any
 * authenticated parking_user could list/view/cancel ANY other citizen's booking
 * tenant-wide (vehicle number, entry/exit times included). Staff (ADMIN_ROLES)
 * retain full tenant visibility; a plain user may only act on bookings they
 * themselves created.
 */
function requireOwnerOrAdmin(ctx: RequestContext, booking: { createdBy: string }): void {
  if (hasAnyRole(ctx, ADMIN_ROLES)) return;
  if (booking.createdBy !== ctx.actorId) {
    throw new HttpError(403, "FORBIDDEN", "Cannot access another user's booking");
  }
}

const createBody = z.object({
  facilityId: z.string().uuid(),
  vehicleNumber: z.string().min(1).max(20),
  vehicleType: z.enum(["two_wheeler", "car", "commercial"]),
  spaceNumber: z.string().optional(),
});

const entryBody = z.object({
  spaceNumber: z.string().optional(),
});

const exitBody = z.object({
  paymentRef: z.string().optional(),
});

const listQuery = z.object({
  status: z.string().optional(),
  facilityId: z.string().uuid().optional(),
  page: z.coerce.number().int().positive().optional(),
  pageSize: z.coerce.number().int().positive().max(100).optional(),
});

const idParam = z.object({ id: z.string().uuid() });

export async function bookingRoutes(app: FastifyInstance): Promise<void> {
  app.post("/v1/parking/bookings", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, USER_ROLES);
    const body = createBody.parse(req.body);
    // facilityId previously had no existence/tenant-match check anywhere (no FK
    // either) — a booking could be created against a nonexistent facility, or
    // one belonging to a different tenant.
    const facility = await facilitiesRepo.findById(body.facilityId, ctx.tenantId);
    if (!facility) throw new HttpError(404, "FACILITY_NOT_FOUND", "Facility not found");
    return reply.code(202).send(await commands.createBooking(ctx, body));
  });

  app.get("/v1/parking/bookings", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, USER_ROLES);
    const q = listQuery.parse(req.query);
    // Non-admins only see their own bookings — previously this returned every
    // booking in the tenant (vehicle numbers, entry/exit times) to any citizen.
    const scopedToSelf = hasAnyRole(ctx, ADMIN_ROLES) ? undefined : ctx.actorId;
    const { rows, total } = await repo.list(ctx.tenantId, { ...q, createdBy: scopedToSelf });
    return reply.send({
      data: rows,
      meta: { page: q.page ?? 1, pageSize: q.pageSize ?? 20, total },
    });
  });

  app.get("/v1/parking/bookings/:id", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, USER_ROLES);
    const { id } = idParam.parse(req.params);
    const cacheKey = `parking:${ctx.tenantId}:booking:${id}`;
    const row = await cache.getOrLoad(cacheKey, () => repo.findById(id, ctx.tenantId));
    if (!row) throw new HttpError(404, "BOOKING_NOT_FOUND", "Booking not found");
    requireOwnerOrAdmin(ctx, row);
    return reply.send({ data: row });
  });

  app.post("/v1/parking/bookings/:id/entry", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, ADMIN_ROLES);
    const { id } = idParam.parse(req.params);
    const body = entryBody.parse(req.body);
    const existing = await repo.findById(id, ctx.tenantId);
    if (!existing) throw new HttpError(404, "BOOKING_NOT_FOUND", "Booking not found");
    if (!canTransition(existing.status, "active")) {
      throw new HttpError(422, "INVALID_STATUS", `Cannot record entry for booking in status '${existing.status}'`);
    }
    return reply.code(202).send(await commands.recordEntry(ctx, id, body.spaceNumber));
  });

  app.post("/v1/parking/bookings/:id/exit", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, ADMIN_ROLES);
    const { id } = idParam.parse(req.params);
    const body = exitBody.parse(req.body);
    const existing = await repo.findById(id, ctx.tenantId);
    if (!existing) throw new HttpError(404, "BOOKING_NOT_FOUND", "Booking not found");
    if (!canTransition(existing.status, "completed")) {
      throw new HttpError(422, "INVALID_STATUS", `Cannot record exit for booking in status '${existing.status}'`);
    }
    return reply.code(202).send(await commands.recordExit(ctx, id, body.paymentRef));
  });

  app.post("/v1/parking/bookings/:id/cancel", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, USER_ROLES);
    const { id } = idParam.parse(req.params);
    const existing = await repo.findById(id, ctx.tenantId);
    if (!existing) throw new HttpError(404, "BOOKING_NOT_FOUND", "Booking not found");
    // Previously any parking_user could cancel ANY other user's booking — no
    // ownership check existed at all.
    requireOwnerOrAdmin(ctx, existing);
    if (!canTransition(existing.status, "cancelled")) {
      throw new HttpError(422, "INVALID_STATUS", `Cannot cancel booking in status '${existing.status}'`);
    }
    return reply.code(202).send(await commands.cancelBooking(ctx, id));
  });
}
