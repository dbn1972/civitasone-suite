import type { FastifyInstance } from "fastify";
import { z, ZodError } from "zod";
import { randomUUID } from "node:crypto";
import { resolveContext, requireRole, HttpError } from "../../shared/context.js";
import { queue } from "../../shared/infra.js";
import { listQuerySchema } from "@civitasone/schemas/common";
import * as repo from "./repo.js";
import { INFRA_CREATE } from "./consumer.js";

const ADMIN = ["super_admin", "location_admin", "asset_admin", "works_admin"];
const INFRA_TYPES = ["road", "bridge", "building", "water_supply", "drainage", "power_line", "telecom_tower", "park"] as const;

export async function infrastructureRoutes(app: FastifyInstance): Promise<void> {
  // SVC-114: real read from location.infrastructure_assets (was []).
  app.get("/v1/locations/infrastructure", async (req, reply) => {
    const ctx = resolveContext(req); requireRole(ctx, ADMIN);
    const q = listQuerySchema.parse(req.query);
    const data = await repo.listByTenant(ctx.tenantId, q.limit, q.offset);
    return reply.send({ data, meta: { total: data.length }, pagination: { hasMore: data.length === q.limit, pageSize: q.limit } });
  });

  app.get("/v1/locations/infrastructure/:id", async (req, reply) => {
    const ctx = resolveContext(req); requireRole(ctx, ADMIN);
    const { id } = z.object({ id: z.string().uuid() }).parse(req.params);
    const asset = await repo.findById(id, ctx.tenantId);
    if (!asset) throw new HttpError(404, "NOT_FOUND", "asset not found");
    return reply.send({ data: asset });
  });

  app.post("/v1/locations/infrastructure", async (req, reply) => {
    const ctx = resolveContext(req); requireRole(ctx, ADMIN);
    const body = z.object({
      name: z.string().min(1).max(200),
      type: z.enum(INFRA_TYPES),
      lat: z.number().min(-90).max(90),
      lng: z.number().min(-180).max(180),
      capacity: z.string().min(1).max(128).optional(),
      conditionScore: z.number().int().min(1).max(5).optional(),
    }).parse(req.body);
    const id = randomUUID();
    await queue.publish(INFRA_CREATE, {
      messageId: id, type: INFRA_CREATE, tenantId: ctx.tenantId, actorId: ctx.actorId,
      correlationId: ctx.correlationId, schemaVersion: "1.0", payload: { id, tenantId: ctx.tenantId, ...body },
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
