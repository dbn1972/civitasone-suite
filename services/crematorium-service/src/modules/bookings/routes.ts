import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { resolveContext, requireRole, HttpError } from "../../shared/context.js";
import { cache } from "../../shared/infra.js";
import * as repo from "./repo.js";
import * as commands from "./commands.js";

const USER_ROLES = ["crematorium_user", "crematorium_admin", "super_admin"];
const ADMIN_ROLES = ["crematorium_admin", "super_admin"];

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
    return reply.code(202).send(await commands.requestBooking(ctx, body));
  });

  app.get("/v1/crematorium/bookings", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, USER_ROLES);
    const q = listQuery.parse(req.query);
    const { rows, total } = await repo.list(ctx.tenantId, q);
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
    return reply.send({ data: row });
  });

  app.post("/v1/crematorium/bookings/:id/confirm", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, ADMIN_ROLES);
    const { id } = idParam.parse(req.params);
    const body = confirmBody.parse(req.body);
    const existing = await repo.findById(id, ctx.tenantId);
    if (!existing) throw new HttpError(404, "BOOKING_NOT_FOUND", "Booking not found");
    if (existing.status !== "requested") {
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
    if (existing.status !== "confirmed") {
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
    if (!["requested", "confirmed"].includes(existing.status)) {
      throw new HttpError(422, "INVALID_STATUS", `Cannot cancel booking in status '${existing.status}'`);
    }
    return reply.code(202).send(await commands.cancelBooking(ctx, id));
  });
}
