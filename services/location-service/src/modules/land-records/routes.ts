import type { FastifyInstance } from "fastify";
import { z, ZodError } from "zod";
import { randomUUID } from "node:crypto";
import { resolveContext, requireRole, HttpError } from "../../shared/context.js";
import { queue } from "../../shared/infra.js";
const ADMIN = ["super_admin", "location_admin", "revenue_officer"];
export async function landRecordRoutes(app: FastifyInstance): Promise<void> {
  app.get("/v1/locations/land-records", async (req, reply) => {
    const ctx = resolveContext(req); requireRole(ctx, ADMIN);
    return reply.send({ data: [], meta: { total: 0 } });
  });
  app.post("/v1/locations/land-records", async (req, reply) => {
    const ctx = resolveContext(req); requireRole(ctx, ADMIN);
    const body = z.object({ surveyNo: z.string().min(1), village: z.string().min(1), district: z.string().min(1), areaHectares: z.number().positive(), ownerName: z.string().min(1), landType: z.enum(["agricultural","residential","commercial","industrial","government","forest"]) }).parse(req.body);
    const id = randomUUID();
    await queue.publish("location.land_record.create", { messageId: id, type: "location.land_record.create", tenantId: ctx.tenantId, actorId: ctx.actorId, correlationId: ctx.correlationId, schemaVersion: "1.0", payload: { id, tenantId: ctx.tenantId, ...body } });
    return reply.code(202).send({ data: { id, status: "accepted" } });
  });
  app.post("/v1/locations/land-records/:id/mutation", async (req, reply) => {
    const ctx = resolveContext(req); requireRole(ctx, ADMIN);
    const { id } = z.object({ id: z.string().uuid() }).parse(req.params);
    const body = z.object({ newOwnerName: z.string().min(1), mutationType: z.enum(["sale","inheritance","gift","partition","government_acquisition"]) }).parse(req.body);
    await queue.publish("location.land_record.mutate", { messageId: randomUUID(), type: "location.land_record.mutate", tenantId: ctx.tenantId, actorId: ctx.actorId, correlationId: ctx.correlationId, schemaVersion: "1.0", payload: { id, ...body } });
    return reply.code(202).send({ data: { id, status: "accepted" } });
  });
  app.setErrorHandler((err, req, reply) => {
    const cid = (req.headers["x-correlation-id"] as string) ?? req.id;
    if (err instanceof ZodError) return reply.code(400).send({ code: "VALIDATION_FAILED", message: "invalid request", correlationId: cid });
    if (err instanceof HttpError) return reply.code(err.status).send({ code: err.code, message: err.message, correlationId: cid });
    req.log.error({ err }, "unhandled"); return reply.code(500).send({ code: "INTERNAL", message: "internal error", correlationId: cid });
  });
}
