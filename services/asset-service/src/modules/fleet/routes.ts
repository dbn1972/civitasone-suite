import type { FastifyInstance } from "fastify";
import { z, ZodError } from "zod";
import { randomUUID } from "node:crypto";
import { resolveContext, requireRole, HttpError } from "../../shared/context.js";
import { queue } from "../../shared/infra.js";
import { COMMANDS } from "../../topics.js";
import * as repo from "./repo.js";

const ADMIN = ["super_admin", "asset_admin", "fleet_manager"];

const listQuerySchema = z.object({
  limit:  z.coerce.number().int().positive().max(200).default(50),
  offset: z.coerce.number().int().nonnegative().default(0),
});

export async function fleetRoutes(app: FastifyInstance): Promise<void> {
  app.get("/v1/assets/fleet/vehicles", async (req, reply) => {
    const ctx = resolveContext(req); requireRole(ctx, ADMIN);
    const q = listQuerySchema.parse(req.query);
    const rows = await repo.listVehiclesByTenant(ctx.tenantId, { limit: q.limit, offset: q.offset });
    return reply.send({ data: rows, limit: q.limit, offset: q.offset });
  });
  app.post("/v1/assets/fleet/vehicles", async (req, reply) => {
    const ctx = resolveContext(req); requireRole(ctx, ADMIN);
    const body = z.object({ registrationNo: z.string().min(1), make: z.string(), model: z.string(), year: z.number().int(), fuelType: z.enum(["petrol","diesel","electric","cng"]) }).parse(req.body);
    const id = randomUUID();
    await queue.publish(COMMANDS.fleetCreate, { messageId: id, type: COMMANDS.fleetCreate, tenantId: ctx.tenantId, actorId: ctx.actorId, correlationId: ctx.correlationId, schemaVersion: "1.0", payload: { id, tenantId: ctx.tenantId, ...body } });
    return reply.code(202).send({ data: { id, status: "accepted" } });
  });
  app.post("/v1/assets/fleet/vehicles/:id/gps", async (req, reply) => {
    const ctx = resolveContext(req); requireRole(ctx, ADMIN);
    const { id } = z.object({ id: z.string().uuid() }).parse(req.params);
    const body = z.object({ lat: z.number(), lng: z.number() }).parse(req.body);
    await queue.publish(COMMANDS.fleetGpsUpdate, { messageId: randomUUID(), type: COMMANDS.fleetGpsUpdate, tenantId: ctx.tenantId, actorId: ctx.actorId, correlationId: ctx.correlationId, schemaVersion: "1.0", payload: { id, tenantId: ctx.tenantId, ...body } });
    return reply.code(202).send({ data: { id, ...body, status: "accepted" } });
  });
  app.get("/v1/assets/fleet/maintenance", async (req, reply) => {
    const ctx = resolveContext(req); requireRole(ctx, ADMIN);
    const q = listQuerySchema.parse(req.query);
    const rows = await repo.listMaintenanceByTenant(ctx.tenantId, { limit: q.limit, offset: q.offset });
    return reply.send({ data: rows, limit: q.limit, offset: q.offset });
  });
  app.setErrorHandler((err, req, reply) => {
    const cid = (req.headers["x-correlation-id"] as string) ?? req.id;
    if (err instanceof ZodError) return reply.code(400).send({ code: "VALIDATION_FAILED", message: "invalid request", correlationId: cid });
    if (err instanceof HttpError) return reply.code(err.status).send({ code: err.code, message: err.message, correlationId: cid });
    req.log.error({ err }, "unhandled"); return reply.code(500).send({ code: "INTERNAL", message: "internal error", correlationId: cid });
  });
}
