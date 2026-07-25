import type { FastifyInstance } from "fastify";
import { z, ZodError } from "zod";
import { randomUUID } from "node:crypto";
import { resolveContext, requireRole, HttpError } from "../../shared/context.js";
import { queue } from "../../shared/infra.js";
const ADMIN = ["super_admin", "location_admin", "revenue_officer", "survey_officer"];
export async function cadastralRoutes(app: FastifyInstance): Promise<void> {
  app.get("/v1/locations/cadastral/parcels", async (req, reply) => {
    const ctx = resolveContext(req); requireRole(ctx, ADMIN);
    const q = z.object({ village: z.string().optional(), district: z.string().optional() }).parse(req.query);
    return reply.send({ data: [], meta: { total: 0 } });
  });
  app.post("/v1/locations/cadastral/parcels", async (req, reply) => {
    const ctx = resolveContext(req); requireRole(ctx, ADMIN);
    const body = z.object({ parcelNo: z.string().min(1), village: z.string().min(1), district: z.string().min(1), areaSquareMeters: z.number().positive(), boundary: z.array(z.object({ lat: z.number(), lng: z.number() })).min(3), landUse: z.enum(["agricultural", "residential", "commercial", "industrial", "forest", "wetland", "barren"]), ownershipType: z.enum(["private", "government", "community", "temple_trust"]) }).parse(req.body);
    const id = randomUUID();
    await queue.publish("location.cadastral.create", { messageId: id, type: "location.cadastral.create", tenantId: ctx.tenantId, actorId: ctx.actorId, correlationId: ctx.correlationId, schemaVersion: "1.0", payload: { id, tenantId: ctx.tenantId, ...body } });
    return reply.code(202).send({ data: { id, status: "accepted" } });
  });
  app.get("/v1/locations/cadastral/parcels/:id/history", async (req, reply) => {
    const ctx = resolveContext(req); requireRole(ctx, ADMIN);
    return reply.send({ data: [] });
  });
  app.post("/v1/locations/cadastral/survey", async (req, reply) => {
    const ctx = resolveContext(req); requireRole(ctx, ADMIN);
    const body = z.object({ parcelIds: z.array(z.string().uuid()).min(1), surveyorId: z.string().uuid(), scheduledDate: z.string().datetime() }).parse(req.body);
    const id = randomUUID();
    await queue.publish("location.survey.schedule", { messageId: id, type: "location.survey.schedule", tenantId: ctx.tenantId, actorId: ctx.actorId, correlationId: ctx.correlationId, schemaVersion: "1.0", payload: { id, ...body } });
    return reply.code(202).send({ data: { surveyId: id, status: "scheduled" } });
  });
  app.post("/v1/locations/cadastral/boundary-dispute", async (req, reply) => {
    const ctx = resolveContext(req); requireRole(ctx, ADMIN);
    const body = z.object({ parcelAId: z.string().uuid(), parcelBId: z.string().uuid(), description: z.string().min(1).max(2000) }).parse(req.body);
    const id = randomUUID();
    await queue.publish("location.dispute.create", { messageId: id, type: "location.dispute.create", tenantId: ctx.tenantId, actorId: ctx.actorId, correlationId: ctx.correlationId, schemaVersion: "1.0", payload: { id, ...body } });
    return reply.code(202).send({ data: { disputeId: id, status: "filed" } });
  });
  app.setErrorHandler((err, req, reply) => {
    const cid = (req.headers["x-correlation-id"] as string) ?? req.id;
    if (err instanceof ZodError) return reply.code(400).send({ code: "VALIDATION_FAILED", message: "invalid request", correlationId: cid });
    if (err instanceof HttpError) return reply.code(err.status).send({ code: err.code, message: err.message, correlationId: cid });
    req.log.error({ err }, "unhandled"); return reply.code(500).send({ code: "INTERNAL", message: "internal error", correlationId: cid });
  });
}
