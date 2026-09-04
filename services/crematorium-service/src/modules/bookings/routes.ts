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

const USER_ROLES = ["crematorium_user", "crematorium_admin", "super_admin"];
const ADMIN_ROLES = ["crematorium_admin", "super_admin"];

/**
 * Bookings have no dedicated "requester" account concept — `createdBy` is set to
 * whoever's token requested the booking (citizen self-service or a counter clerk
 * acting on a citizen's behalf), so it's the closest available notion of "owner."
 * Staff (ADMIN_ROLES) can act on any booking in the tenant; a plain USER_ROLES
 * caller may only act on bookings they themselves created. Without this, any
 * authenticated crematorium_user could view or cancel any OTHER citizen's booking
 * tenant-wide (applicant name/phone/deceased details included) — confirmed as a
 * real gap, not a hypothetical, since nothing previously compared caller identity
 * to the booking at all.
 */
function requireOwnerOrAdmin(ctx: RequestContext, booking: { createdBy: string }): void {
  if (hasAnyRole(ctx, ADMIN_ROLES)) return;
  if (booking.createdBy !== ctx.actorId) {
    throw new HttpError(403, "FORBIDDEN", "Cannot access another user's booking");
  }
}

const requestBody = z.object({
  facilityId: z.string().uuid(),
  applicantName: z.string().min(1).max(256),
  applicantPhone: z.string().min(10).max(20),
  applicantRelation: z.string().max(32).optional(),
  deceasedName: z.string().min(1).max(256),
  deceasedAge: z.number().int().nonnegative().optional(),
  deceasedGender: z.enum(["male", "female", "other"]).optional(),
  deathCertificateRef: z.string().optional(),
  serviceType: z.enum(["cremation", "burial", "electric_cremation"]),
  requestedDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  requestedSlot: z.string().optional(),
});

const confirmBody = z.object({
  slotNumber: z.string().min(1),
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
  app.post("/v1/crematorium/bookings", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, USER_ROLES);
    const body = requestBody.parse(req.body);
    // Was previously accepted with zero validation: facilityId had no existence or
    // tenant-match check anywhere in the request→command→consumer chain, so a
    // booking could be created against a nonexistent facility, or (since facilityId
    // carries no FK) one belonging to a different tenant entirely.
    const facility = await facilitiesRepo.findById(body.facilityId, ctx.tenantId);
    if (!facility) throw new HttpError(404, "FACILITY_NOT_FOUND", "Facility not found");
    // Pre-accept validation gap found while hardening this route: nothing
    // previously checked the facility's operational status here, so a
    // booking could be requested against a facility already set to
    // "under_maintenance" or "closed" (facilities/routes.ts PATCH lets an
    // admin set either) -- accepted with 202 and only ever surfacing as a
    // downstream operational problem when staff try to actually use it.
    // Same bug class as asset-service's "under_maintenance assets must not
    // be transferable" fix.
    if (facility.status !== "active") {
      throw new HttpError(422, "FACILITY_NOT_ACTIVE", `Facility is ${facility.status}, not accepting bookings`);
    }
    return reply.code(202).send(await commands.requestBooking(ctx, body));
  });

  app.get("/v1/crematorium/bookings", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, USER_ROLES);
    const q = listQuery.parse(req.query);
    // A plain citizen (crematorium_user) only ever sees their own bookings; staff
    // (ADMIN_ROLES) retain full tenant-wide visibility. Previously this endpoint
    // returned every booking in the tenant — applicant name/phone/deceased details
    // included — to any authenticated crematorium_user regardless of who filed it.
    const scopedToSelf = hasAnyRole(ctx, ADMIN_ROLES) ? undefined : ctx.actorId;
    const { rows, total } = await repo.list(ctx.tenantId, { ...q, createdBy: scopedToSelf });
    return reply.send({
      data: rows,
      meta: { page: q.page ?? 1, pageSize: q.pageSize ?? 20, total },
    });
  });

  app.get("/v1/crematorium/bookings/:id", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, USER_ROLES);
    const { id } = idParam.parse(req.params);
    const cacheKey = `crematorium:${ctx.tenantId}:booking:${id}`;
    const row = await cache.getOrLoad(cacheKey, () => repo.findById(id, ctx.tenantId));
    if (!row) throw new HttpError(404, "BOOKING_NOT_FOUND", "Booking not found");
    requireOwnerOrAdmin(ctx, row);
    return reply.send({ data: row });
  });

  app.post("/v1/crematorium/bookings/:id/confirm", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, ADMIN_ROLES);
    const { id } = idParam.parse(req.params);
    const body = confirmBody.parse(req.body);
    const existing = await repo.findById(id, ctx.tenantId);
    if (!existing) throw new HttpError(404, "BOOKING_NOT_FOUND", "Booking not found");
    if (!canTransition(existing.status, "confirmed")) {
      throw new HttpError(422, "INVALID_STATUS", `Cannot confirm booking in status '${existing.status}'`);
    }
    return reply.code(202).send(await commands.confirmBooking(ctx, id, body.slotNumber, body.paymentRef));
  });

  app.post("/v1/crematorium/bookings/:id/complete", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, ADMIN_ROLES);
    const { id } = idParam.parse(req.params);
    const existing = await repo.findById(id, ctx.tenantId);
    if (!existing) throw new HttpError(404, "BOOKING_NOT_FOUND", "Booking not found");
    if (!canTransition(existing.status, "completed")) {
      throw new HttpError(422, "INVALID_STATUS", `Cannot complete booking in status '${existing.status}'`);
    }
    return reply.code(202).send(await commands.completeBooking(ctx, id));
  });

  app.post("/v1/crematorium/bookings/:id/cancel", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, USER_ROLES);
    const { id } = idParam.parse(req.params);
    const existing = await repo.findById(id, ctx.tenantId);
    if (!existing) throw new HttpError(404, "BOOKING_NOT_FOUND", "Booking not found");
    // Previously any crematorium_user could cancel ANY other user's booking in the
    // tenant — confirm/complete already required ADMIN_ROLES, but cancel alone
    // accepted the broader USER_ROLES with no compensating ownership check at all.
    requireOwnerOrAdmin(ctx, existing);
    if (!canTransition(existing.status, "cancelled")) {
      throw new HttpError(422, "INVALID_STATUS", `Cannot cancel booking in status '${existing.status}'`);
    }
    return reply.code(202).send(await commands.cancelBooking(ctx, id));
  });
}
