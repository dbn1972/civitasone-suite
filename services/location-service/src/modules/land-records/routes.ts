import type { FastifyInstance } from "fastify";
import { ZodError } from "zod";
import { randomUUID } from "node:crypto";
import { resolveContext, requireRole, HttpError } from "../../shared/context.js";
import { queue } from "../../shared/infra.js";
import { listQuerySchema } from "@civitasone/schemas/common";
import * as repo from "./repo.js";
import { createLandRecordBody, mutateLandRecordBody, idParam } from "./validators.js";
import { LAND_RECORD_CREATE, LAND_RECORD_MUTATE } from "./consumer.js";

const ADMIN = ["super_admin", "location_admin", "revenue_officer"];

export async function landRecordRoutes(app: FastifyInstance): Promise<void> {
  // SVC-113: real read from location.land_records (was a hardcoded []).
  app.get("/v1/locations/land-records", async (req, reply) => {
    const ctx = resolveContext(req); requireRole(ctx, ADMIN);
    const q = listQuerySchema.parse(req.query);
    const data = await repo.listByTenant(ctx.tenantId, q.limit, q.offset);
    return reply.send({ data, meta: { total: data.length }, pagination: { hasMore: data.length === q.limit, pageSize: q.limit } });
  });

  app.get("/v1/locations/land-records/:id", async (req, reply) => {
    const ctx = resolveContext(req); requireRole(ctx, ADMIN);
    const { id } = idParam.parse(req.params);
    const rec = await repo.findById(id, ctx.tenantId);
    if (!rec) throw new HttpError(404, "NOT_FOUND", "land record not found");
    return reply.send({ data: rec });
  });

  app.post("/v1/locations/land-records", async (req, reply) => {
    const ctx = resolveContext(req); requireRole(ctx, ADMIN);
    const body = createLandRecordBody.parse(req.body);
    const id = randomUUID();
    await queue.publish(LAND_RECORD_CREATE, {
      messageId: id, type: LAND_RECORD_CREATE, tenantId: ctx.tenantId, actorId: ctx.actorId,
      correlationId: ctx.correlationId, schemaVersion: "1.0", payload: { id, tenantId: ctx.tenantId, ...body },
    });
    return reply.code(202).send({ data: { id, status: "accepted" } });
  });

  app.post("/v1/locations/land-records/:id/mutation", async (req, reply) => {
    const ctx = resolveContext(req); requireRole(ctx, ADMIN);
    const { id } = idParam.parse(req.params);
    const body = mutateLandRecordBody.parse(req.body);
    await queue.publish(LAND_RECORD_MUTATE, {
      messageId: randomUUID(), type: LAND_RECORD_MUTATE, tenantId: ctx.tenantId, actorId: ctx.actorId,
      correlationId: ctx.correlationId, schemaVersion: "1.0", payload: { id, newOwnerName: body.newOwnerName, mutationType: body.mutationType },
    });
    return reply.code(202).send({ data: { id, status: "accepted" } });
  });

  app.setErrorHandler((err, req, reply) => {
    const cid = (req.headers["x-correlation-id"] as string) ?? req.id;
    if (err instanceof ZodError) return reply.code(400).send({ code: "VALIDATION_FAILED", message: "invalid request", correlationId: cid });
    if (err instanceof HttpError) return reply.code(err.status).send({ code: err.code, message: err.message, correlationId: cid });
    req.log.error({ err }, "unhandled"); return reply.code(500).send({ code: "INTERNAL", message: "internal error", correlationId: cid });
  });
}
