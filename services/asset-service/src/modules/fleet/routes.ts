import type { FastifyInstance } from "fastify";
import { z, ZodError } from "zod";
import { randomUUID } from "node:crypto";
import { resolveContext, requireRole, HttpError } from "../../shared/context.js";
import { queue } from "../../shared/infra.js";
import { COMMANDS } from "../../topics.js";
import * as repo from "./repo.js";

const ADMIN  = ["super_admin", "asset_admin", "fleet_manager"];
const READER = [...ADMIN, "audit_officer"];

const listQuerySchema = z.object({
  limit:  z.coerce.number().int().positive().max(200).default(50),
  offset: z.coerce.number().int().nonnegative().default(0),
});

const idParam = z.object({ id: z.string().uuid() });

export async function fleetRoutes(app: FastifyInstance): Promise<void> {
  // ── Vehicles ────────────────────────────────────────────────────────────

  app.get("/v1/assets/fleet/vehicles", async (req, reply) => {
    const ctx = resolveContext(req); requireRole(ctx, READER);
    const q = listQuerySchema.parse(req.query);
    const rows = await repo.listVehiclesByTenant(ctx.tenantId, { limit: q.limit, offset: q.offset });
    return reply.send({ data: rows, limit: q.limit, offset: q.offset });
  });

  app.get("/v1/assets/fleet/vehicles/:id", async (req, reply) => {
    const ctx = resolveContext(req); requireRole(ctx, READER);
    const { id } = idParam.parse(req.params);
    const row = await repo.findVehicleById(id, ctx.tenantId);
    if (!row) throw new HttpError(404, "NOT_FOUND", "vehicle not found");
    return reply.send({ data: row });
  });

  app.post("/v1/assets/fleet/vehicles", async (req, reply) => {
    const ctx = resolveContext(req); requireRole(ctx, ADMIN);
    const body = z.object({
      registrationNo: z.string().min(1).max(20),
      make:           z.string().min(1).max(64),
      model:          z.string().min(1).max(64),
      year:           z.number().int().min(1980).max(2100),
      fuelType:       z.enum(["petrol", "diesel", "electric", "cng"]),
    }).parse(req.body);
    const id = randomUUID();
    await queue.publish(COMMANDS.fleetCreate, {
      messageId: id, type: COMMANDS.fleetCreate,
      tenantId: ctx.tenantId, actorId: ctx.actorId,
      correlationId: ctx.correlationId, schemaVersion: "1.0",
      payload: { id, tenantId: ctx.tenantId, ...body },
    });
    return reply.code(202).send({ data: { id, status: "accepted" } });
  });

  app.patch("/v1/assets/fleet/vehicles/:id", async (req, reply) => {
    const ctx = resolveContext(req); requireRole(ctx, ADMIN);
    const { id } = idParam.parse(req.params);
    const body = z.object({
      registrationNo: z.string().min(1).max(20).optional(),
      make:           z.string().min(1).max(64).optional(),
      model:          z.string().min(1).max(64).optional(),
      year:           z.number().int().optional(),
      fuelType:       z.enum(["petrol", "diesel", "electric", "cng"]).optional(),
      odometerKm:     z.number().int().nonnegative().optional(),
      status:         z.enum(["active", "in_maintenance", "decommissioned"]).optional(),
    }).parse(req.body);
    const msgId = randomUUID();
    await queue.publish(COMMANDS.fleetVehicleUpdate, {
      messageId: msgId, type: COMMANDS.fleetVehicleUpdate,
      tenantId: ctx.tenantId, actorId: ctx.actorId,
      correlationId: ctx.correlationId, schemaVersion: "1.0",
      payload: { id, tenantId: ctx.tenantId, ...body },
    });
    return reply.code(202).send({ data: { id, status: "accepted" } });
  });

  app.patch("/v1/assets/fleet/vehicles/:id/assign-driver", async (req, reply) => {
    const ctx = resolveContext(req); requireRole(ctx, ADMIN);
    const { id } = idParam.parse(req.params);
    const body = z.object({
      driverId: z.string().uuid().nullable(),
    }).parse(req.body);
    const msgId = randomUUID();
    await queue.publish(COMMANDS.fleetAssignDriver, {
      messageId: msgId, type: COMMANDS.fleetAssignDriver,
      tenantId: ctx.tenantId, actorId: ctx.actorId,
      correlationId: ctx.correlationId, schemaVersion: "1.0",
      payload: { vehicleId: id, tenantId: ctx.tenantId, driverId: body.driverId },
    });
    return reply.code(202).send({ data: { id, status: "accepted" } });
  });

  app.post("/v1/assets/fleet/vehicles/:id/gps", async (req, reply) => {
    const ctx = resolveContext(req); requireRole(ctx, ADMIN);
    const { id } = idParam.parse(req.params);
    const body = z.object({
      lat: z.number(),
      lng: z.number(),
    }).parse(req.body);
    await queue.publish(COMMANDS.fleetGpsUpdate, {
      messageId: randomUUID(), type: COMMANDS.fleetGpsUpdate,
      tenantId: ctx.tenantId, actorId: ctx.actorId,
      correlationId: ctx.correlationId, schemaVersion: "1.0",
      payload: { id, tenantId: ctx.tenantId, ...body },
    });
    return reply.code(202).send({ data: { id, ...body, status: "accepted" } });
  });

  // ── Maintenance ─────────────────────────────────────────────────────────

  app.get("/v1/assets/fleet/maintenance", async (req, reply) => {
    const ctx = resolveContext(req); requireRole(ctx, READER);
    const q = listQuerySchema.parse(req.query);
    const rows = await repo.listMaintenanceByTenant(ctx.tenantId, { limit: q.limit, offset: q.offset });
    return reply.send({ data: rows, limit: q.limit, offset: q.offset });
  });

  app.patch("/v1/assets/fleet/maintenance/:id/complete", async (req, reply) => {
    const ctx = resolveContext(req); requireRole(ctx, ADMIN);
    const { id } = idParam.parse(req.params);
    const body = z.object({
      costMinor: z.number().int().nonnegative().optional(),
    }).parse(req.body);
    const job = await repo.findMaintenanceById(id, ctx.tenantId);
    if (!job) throw new HttpError(404, "NOT_FOUND", "maintenance record not found");
    if (job.status === "completed") throw new HttpError(409, "ALREADY_COMPLETED", "maintenance already marked as completed");
    const msgId = randomUUID();
    await queue.publish(COMMANDS.fleetMaintenanceComplete, {
      messageId: msgId, type: COMMANDS.fleetMaintenanceComplete,
      tenantId: ctx.tenantId, actorId: ctx.actorId,
      correlationId: ctx.correlationId, schemaVersion: "1.0",
      payload: { id, tenantId: ctx.tenantId, costMinor: body.costMinor ?? null },
    });
    return reply.code(202).send({ data: { id, status: "accepted" } });
  });

  // ── Dashboard ───────────────────────────────────────────────────────────

  app.get("/v1/assets/fleet/dashboard", async (req, reply) => {
    const ctx = resolveContext(req); requireRole(ctx, READER);
    const stats = await repo.getFleetDashboard(ctx.tenantId);
    return reply.send({ data: stats });
  });

  // ── Error handler ───────────────────────────────────────────────────────

  app.setErrorHandler((err, req, reply) => {
    const cid = (req.headers["x-correlation-id"] as string) ?? req.id;
    if (err instanceof ZodError)
      return reply.code(400).send({ code: "VALIDATION_FAILED", message: "invalid request", correlationId: cid });
    if (err instanceof HttpError)
      return reply.code(err.status).send({ code: err.code, message: err.message, correlationId: cid });
    req.log.error({ err }, "unhandled");
    return reply.code(500).send({ code: "INTERNAL", message: "internal error", correlationId: cid });
  });
}
