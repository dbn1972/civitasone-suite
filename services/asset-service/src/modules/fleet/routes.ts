import type { FastifyInstance } from "fastify";
import { z, ZodError } from "zod";
import { randomUUID } from "node:crypto";
import { resolveContext, requireRole, HttpError } from "../../shared/context.js";
import { queue } from "../../shared/infra.js";
const ADMIN = ["super_admin", "asset_admin", "fleet_manager"];
export async function fleetRoutes(app: FastifyInstance): Promise<void> {
  app.get("/v1/assets/fleet/vehicles", async (req, reply) => {
    const ctx = resolveContext(req); requireRole(ctx, ADMIN);
    return reply.send({ data: [] });
  });
  app.post("/v1/assets/fleet/vehicles", async (req, reply) => {
    const ctx = resolveContext(req); requireRole(ctx, ADMIN);
    const body = z.object({ registrationNo: z.string().min(1), make: z.string(), model: z.string(), year: z.number().int(), fuelType: z.enum(["petrol","diesel","electric","cng"]) }).parse(req.body);
    const id = randomUUID();
    await queue.publish("asset.fleet.create", { messageId: id, type: "asset.fleet.create", tenantId: ctx.tenantId, actorId: ctx.actorId, correlationId: ctx.correlationId, schemaVersion: "1.0", payload: { id, tenantId: ctx.tenantId, ...body } });
    return reply.code(202).send({ data: { id, status: "accepted" } });
  });
  app.post("/v1/assets/fleet/vehicles/:id/gps", async (req, reply) => {
    const ctx = resolveContext(req); requireRole(ctx, ADMIN);
    const { id } = z.object({ id: z.string().uuid() }).parse(req.params);
    const body = z.object({ lat: z.number(), lng: z.number() }).parse(req.body);
    return reply.send({ data: { id, ...body, updatedAt: new Date().toISOString() } });
  });
  app.get("/v1/assets/fleet/maintenance", async (req, reply) => {
    const ctx = resolveContext(req); requireRole(ctx, ADMIN);
    return reply.send({ data: [] });
  });
  app.setErrorHandler((err, req, reply) => {
    const cid = (req.headers["x-correlation-id"] as string) ?? req.id;
    if (err instanceof ZodError) return reply.code(400).send({ code: "VALIDATION_FAILED", message: "invalid request", correlationId: cid });
    if (err instanceof HttpError) return reply.code(err.status).send({ code: err.code, message: err.message, correlationId: cid });
    req.log.error({ err }, "unhandled"); return reply.code(500).send({ code: "INTERNAL", message: "internal error", correlationId: cid });
  });
}
