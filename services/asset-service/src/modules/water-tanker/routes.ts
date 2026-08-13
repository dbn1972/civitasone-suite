import type { FastifyInstance } from "fastify";
import { z, ZodError } from "zod";
import { resolveContext, requireRole, HttpError } from "../../shared/context.js";
import * as commands from "./commands.js";
import * as repo from "./repo.js";

const ROLES = ["super_admin", "asset_admin", "water_admin", "water_operator"];

const listQuerySchema = z.object({
  limit:  z.coerce.number().int().positive().max(200).default(50),
  offset: z.coerce.number().int().nonnegative().default(0),
});

export async function waterTankerRoutes(app: FastifyInstance): Promise<void> {
  app.post("/v1/assets/water/tanker-bookings", async (req, reply) => {
    const ctx = resolveContext(req); requireRole(ctx, ROLES);
    const body = z.object({
      deliveryAddress: z.record(z.unknown()).optional(),
      ward: z.string().optional(),
      tankerCapacityLitres: z.number().int().positive(),
      requestedDate: z.string(),
      requestedSlot: z.string().optional(),
    }).parse(req.body);
    const result = await commands.createBooking(ctx, body);
    return reply.code(202).send({ data: result });
  });

  app.get("/v1/assets/water/tanker-bookings", async (req, reply) => {
    const ctx = resolveContext(req); requireRole(ctx, ROLES);
    const q = listQuerySchema.parse(req.query);
    const rows = await repo.listBookings(ctx.tenantId, { limit: q.limit, offset: q.offset });
    return reply.send({ data: rows, limit: q.limit, offset: q.offset });
  });

  app.get("/v1/assets/water/tanker-bookings/:id", async (req, reply) => {
    const ctx = resolveContext(req); requireRole(ctx, ROLES);
    const { id } = z.object({ id: z.string().uuid() }).parse(req.params);
    const row = await repo.findBookingById(id, ctx.tenantId);
    if (!row) throw new HttpError(404, "NOT_FOUND", "booking not found");
    return reply.send({ data: row });
  });

  app.post("/v1/assets/water/tanker-bookings/:id/schedule", async (req, reply) => {
    const ctx = resolveContext(req); requireRole(ctx, ROLES);
    const { id } = z.object({ id: z.string().uuid() }).parse(req.params);
    const body = z.object({
      scheduledDate: z.string(), tankerVehicleId: z.string().optional(), driverId: z.string().uuid().optional(),
    }).parse(req.body);
    const result = await commands.scheduleBooking(ctx, id, body);
    return reply.code(202).send({ data: result });
  });

  app.post("/v1/assets/water/tanker-bookings/:id/dispatch", async (req, reply) => {
    const ctx = resolveContext(req); requireRole(ctx, ROLES);
    const { id } = z.object({ id: z.string().uuid() }).parse(req.params);
    const result = await commands.dispatchBooking(ctx, id);
    return reply.code(202).send({ data: result });
  });

  app.post("/v1/assets/water/tanker-bookings/:id/deliver", async (req, reply) => {
    const ctx = resolveContext(req); requireRole(ctx, ROLES);
    const { id } = z.object({ id: z.string().uuid() }).parse(req.params);
    const result = await commands.deliverBooking(ctx, id);
    return reply.code(202).send({ data: result });
  });

  app.post("/v1/assets/water/tanker-bookings/:id/cancel", async (req, reply) => {
    const ctx = resolveContext(req); requireRole(ctx, ROLES);
    const { id } = z.object({ id: z.string().uuid() }).parse(req.params);
    const result = await commands.cancelBooking(ctx, id);
    return reply.code(202).send({ data: result });
  });

  app.setErrorHandler((err, req, reply) => {
    const cid = (req.headers["x-correlation-id"] as string) ?? req.id;
    if (err instanceof ZodError) return reply.code(400).send({ code: "VALIDATION_FAILED", message: "invalid request", correlationId: cid });
    if (err instanceof HttpError) return reply.code(err.status).send({ code: err.code, message: err.message, correlationId: cid });
    req.log.error({ err }, "unhandled"); return reply.code(500).send({ code: "INTERNAL", message: "internal error", correlationId: cid });
  });
}
