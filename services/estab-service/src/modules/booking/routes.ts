/**
 * Booking routes — facility booking workflow (BRD 5.22 HALL-001…005).
 */
import { z } from "zod";
import { sendAccepted } from "@civitasone/schemas/validate";
import { acceptedResponseSchema } from "@civitasone/schemas/common";
import type { FastifyInstance } from "fastify";
import { hasAnyRole } from "@civitasone/auth";
import type { RequestContext } from "@civitasone/types";
import { resolveContext, requireRole, HttpError } from "../../shared/context.js";
import { maskAndAuditRead } from "../../shared/data-governance.js";
import * as commands from "./commands.js";
import * as queries from "./queries.js";

const ADMIN_ROLES  = ["estab_officer", "estab_admin", "super_admin"];
const CITIZEN_ROLES = [...ADMIN_ROLES, "citizen", "employee"];
// Recording a payment settles a booking: officers and accounts roles only,
// never the citizen who owes the money.
const PAYMENT_ROLES = [...ADMIN_ROLES, "finance_officer", "finance_admin"];

// IDOR: officers see the tenant's bookings; citizen/employee callers only the
// ones they created.
const ownerScope = (ctx: RequestContext): string | undefined =>
  hasAnyRole(ctx, ADMIN_ROLES) ? undefined : ctx.actorId;

async function assertCanAct(ctx: RequestContext, id: string): Promise<void> {
  const owner = ownerScope(ctx);
  if (owner && !(await queries.getBooking(ctx.tenantId, id, owner))) {
    throw new HttpError(404, "NOT_FOUND", "booking not found");
  }
}

const idParam = z.object({ id: z.string().uuid() });
const dateQuery = z.object({ date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/) });
// PERF-006: limit/offset added so listFacilities/listBookings (both
// tenant-wide) return a bounded page -- mirrors citizen-lease/routes.ts's
// listQuery in this same service.
const listQuery = z.object({
  status: z.string().optional(),
  limit:  z.coerce.number().int().positive().max(200).default(50),
  offset: z.coerce.number().int().nonnegative().default(0),
});

const createFacilityBody = z.object({
  facilityName: z.string().min(1),
  facilityType: z.enum(["community_hall", "auditorium", "stadium", "park", "open_ground", "marriage_hall", "convention_center"]),
  address: z.record(z.unknown()).optional(),
  ward: z.string().optional(),
  capacity: z.number().int().positive().optional(),
  amenities: z.array(z.unknown()).optional(),
  photos: z.array(z.unknown()).optional(),
  ratePerHourMinor: z.number().int().nonnegative().optional(),
  ratePerDayMinor: z.number().int().nonnegative().optional(),
  currency: z.string().length(3).optional(),
  securityDepositMinor: z.number().int().nonnegative().optional(),
  operatingHours: z.record(z.unknown()).optional(),
  closedDays: z.array(z.unknown()).optional(),
  rules: z.string().optional(),
  contactPerson: z.string().optional(),
  contactPhone: z.string().max(15).optional(),
});

const updateFacilityBody = createFacilityBody.partial();

const createBookingBody = z.object({
  facilityId: z.string().uuid(),
  applicantName: z.string().min(1),
  applicantPhone: z.string().max(15),
  applicantEmail: z.string().email().optional(),
  purpose: z.string().optional(),
  eventType: z.enum(["wedding", "meeting", "cultural", "sports", "religious", "government", "other"]).optional(),
  eventDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  startTime: z.string().regex(/^\d{2}:\d{2}$/),
  endTime: z.string().regex(/^\d{2}:\d{2}$/),
  durationHours: z.number().int().positive().optional(),
  guestCount: z.number().int().positive().optional(),
  requirements: z.record(z.unknown()).optional(),
});

const paymentBody = z.object({ paymentRef: z.string().optional() });
const cancelBody = z.object({ cancellationReason: z.string().optional() });

export async function bookingRoutes(app: FastifyInstance): Promise<void> {
  // ── Facilities ─────────────────────────────────────────────────────────
  app.post("/v1/estab/booking/facilities", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, ADMIN_ROLES);
    const body = createFacilityBody.parse(req.body);
    return sendAccepted(reply, acceptedResponseSchema, await commands.createFacility(ctx, body));
  });

  app.patch("/v1/estab/booking/facilities/:id", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, ADMIN_ROLES);
    const { id } = idParam.parse(req.params);
    const body = updateFacilityBody.parse(req.body);
    return sendAccepted(reply, acceptedResponseSchema, await commands.updateFacility(ctx, id, body));
  });

  app.get("/v1/estab/booking/facilities", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, CITIZEN_ROLES);
    const q = listQuery.parse(req.query);
    return reply.send(await queries.listFacilities(ctx.tenantId, { status: q.status }, q.limit, q.offset));
  });

  app.get("/v1/estab/booking/facilities/:id", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, CITIZEN_ROLES);
    const { id } = idParam.parse(req.params);
    const facility = await queries.getFacility(ctx.tenantId, id);
    if (!facility) throw new HttpError(404, "NOT_FOUND", "facility not found");
    return reply.send({ data: facility });
  });

  app.get("/v1/estab/booking/facilities/:id/availability", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, CITIZEN_ROLES);
    const { id } = idParam.parse(req.params);
    const { date } = dateQuery.parse(req.query);
    return reply.send({ data: await queries.getFacilityAvailability(ctx.tenantId, id, date) });
  });

  // ── Bookings ───────────────────────────────────────────────────────────
  app.post("/v1/estab/booking/bookings", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, CITIZEN_ROLES);
    const body = createBookingBody.parse(req.body);
    return sendAccepted(reply, acceptedResponseSchema, await commands.createBooking(ctx, body));
  });

  app.get("/v1/estab/booking/bookings", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, CITIZEN_ROLES);
    const q = listQuery.parse(req.query);
    const page = await queries.listBookings(ctx.tenantId, { status: q.status, ownerId: ownerScope(ctx) }, q.limit, q.offset);
    return reply.send({ ...page, data: await maskAndAuditRead(ctx, "booking", page.data as Record<string, unknown>[]) });
  });

  app.get("/v1/estab/booking/bookings/:id", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, CITIZEN_ROLES);
    const { id } = idParam.parse(req.params);
    const booking = await queries.getBooking(ctx.tenantId, id, ownerScope(ctx));
    if (!booking) throw new HttpError(404, "NOT_FOUND", "booking not found");
    const [masked] = await maskAndAuditRead(ctx, "booking", [booking as Record<string, unknown>]);
    return reply.send({ data: masked });
  });

  app.post("/v1/estab/booking/bookings/:id/submit", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, CITIZEN_ROLES);
    const { id } = idParam.parse(req.params);
    await assertCanAct(ctx, id);
    return sendAccepted(reply, acceptedResponseSchema, await commands.submitBooking(ctx, id));
  });

  app.post("/v1/estab/booking/bookings/:id/approve", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, ADMIN_ROLES);
    const { id } = idParam.parse(req.params);
    return sendAccepted(reply, acceptedResponseSchema, await commands.approveBooking(ctx, id));
  });

  app.post("/v1/estab/booking/bookings/:id/pay", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, PAYMENT_ROLES);
    const { id } = idParam.parse(req.params);
    const body = paymentBody.parse(req.body);
    return sendAccepted(reply, acceptedResponseSchema, await commands.recordPayment(ctx, id, body));
  });

  app.post("/v1/estab/booking/bookings/:id/cancel", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, CITIZEN_ROLES);
    const { id } = idParam.parse(req.params);
    await assertCanAct(ctx, id);
    const body = cancelBody.parse(req.body);
    return sendAccepted(reply, acceptedResponseSchema, await commands.cancelBooking(ctx, id, body));
  });

  app.post("/v1/estab/booking/bookings/:id/complete", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, ADMIN_ROLES);
    const { id } = idParam.parse(req.params);
    return sendAccepted(reply, acceptedResponseSchema, await commands.completeBooking(ctx, id));
  });
}
