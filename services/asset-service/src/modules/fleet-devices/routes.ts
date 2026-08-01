import type { FastifyInstance } from "fastify";
import { z, ZodError } from "zod";
import { randomUUID } from "node:crypto";
import { resolveContext, requireRole, HttpError } from "../../shared/context.js";
import { queue } from "../../shared/infra.js";
import { COMMANDS } from "../../topics.js";
import * as repo from "../fleet/repo.js";

const ADMIN = ["super_admin", "asset_admin", "fleet_manager"];

const listQuerySchema = z.object({
  limit:  z.coerce.number().int().positive().max(200).default(50),
  offset: z.coerce.number().int().nonnegative().default(0),
});

export async function fleetDeviceRoutes(app: FastifyInstance): Promise<void> {
  app.post("/v1/assets/fleet/devices", async (req, reply) => {
    const ctx = resolveContext(req); requireRole(ctx, ADMIN);
    const body = z.object({ vehicleId: z.string().uuid(), deviceImei: z.string().min(15).max(15), protocol: z.enum(["gt06", "teltonika", "queclink", "concox"]), simIccid: z.string().optional() }).parse(req.body);
    const id = randomUUID();
    await queue.publish(COMMANDS.fleetDeviceRegister, { messageId: id, type: COMMANDS.fleetDeviceRegister, tenantId: ctx.tenantId, actorId: ctx.actorId, correlationId: ctx.correlationId, schemaVersion: "1.0", payload: { id, tenantId: ctx.tenantId, ...body } });
    return reply.code(202).send({ data: { id, status: "registered" } });
  });
  app.get("/v1/assets/fleet/devices", async (req, reply) => {
    const ctx = resolveContext(req); requireRole(ctx, ADMIN);
    const q = listQuerySchema.parse(req.query);
    const rows = await repo.listDevicesByTenant(ctx.tenantId, { limit: q.limit, offset: q.offset });
    return reply.send({ data: rows, meta: { total: rows.length } });
  });
  app.post("/v1/assets/fleet/devices/:id/telemetry", async (req, reply) => {
    const ctx = resolveContext(req); requireRole(ctx, ADMIN);
    const { id } = z.object({ id: z.string().uuid() }).parse(req.params);
    const body = z.object({ lat: z.number(), lng: z.number(), speed: z.number().min(0), heading: z.number().min(0).max(360), fuelLevel: z.number().min(0).max(100).optional(), engineOn: z.boolean().optional(), timestamp: z.string().datetime() }).parse(req.body);
    await queue.publish(COMMANDS.fleetDeviceTelemetry, { messageId: randomUUID(), type: COMMANDS.fleetDeviceTelemetry, tenantId: ctx.tenantId, actorId: ctx.actorId, correlationId: ctx.correlationId, schemaVersion: "1.0", payload: { deviceId: id, tenantId: ctx.tenantId, lat: body.lat, lng: body.lng, speed: body.speed, heading: body.heading, fuelLevelPct: body.fuelLevel, engineOn: body.engineOn, timestamp: body.timestamp } });
    return reply.code(202).send({ data: { deviceId: id, received: true } });
  });
  app.post("/v1/assets/fleet/maintenance/schedule", async (req, reply) => {
    const ctx = resolveContext(req); requireRole(ctx, ADMIN);
    const body = z.object({ vehicleId: z.string().uuid(), type: z.enum(["oil_change", "tire_rotation", "brake_inspection", "full_service", "battery_check"]), scheduledDate: z.string().datetime(), odometerThresholdKm: z.number().int().optional() }).parse(req.body);
    const id = randomUUID();
    await queue.publish(COMMANDS.fleetScheduleMaintenance, { messageId: id, type: COMMANDS.fleetScheduleMaintenance, tenantId: ctx.tenantId, actorId: ctx.actorId, correlationId: ctx.correlationId, schemaVersion: "1.0", payload: { id, tenantId: ctx.tenantId, ...body } });
    return reply.code(202).send({ data: { id, status: "scheduled" } });
  });
  app.setErrorHandler((err, req, reply) => {
    const cid = (req.headers["x-correlation-id"] as string) ?? req.id;
    if (err instanceof ZodError) return reply.code(400).send({ code: "VALIDATION_FAILED", message: "invalid request", correlationId: cid });
    if (err instanceof HttpError) return reply.code(err.status).send({ code: err.code, message: err.message, correlationId: cid });
    req.log.error({ err }, "unhandled"); return reply.code(500).send({ code: "INTERNAL", message: "internal error", correlationId: cid });
  });
}
