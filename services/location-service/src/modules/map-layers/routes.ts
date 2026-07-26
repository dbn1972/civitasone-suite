import type { FastifyInstance } from "fastify";
import { z, ZodError } from "zod";
import { randomUUID } from "node:crypto";
import { resolveContext, requireRole, HttpError } from "../../shared/context.js";
import * as repo from "./repo.js";

const ADMIN = ["super_admin", "location_admin", "gis_admin"];
const READER = ["super_admin", "location_admin", "gis_admin", "location_user", "project_admin"];
const SOURCE_TYPES = ["tile", "wms", "geojson"] as const;

export async function mapLayerRoutes(app: FastifyInstance): Promise<void> {
  // SVC-112: map-layer configuration API consumed by the web map viewer.
  app.get("/v1/locations/map-layers", async (req, reply) => {
    const ctx = resolveContext(req); requireRole(ctx, READER);
    const data = await repo.list(ctx.tenantId);
    return reply.send({ data, meta: { total: data.length } });
  });

  app.post("/v1/locations/map-layers", async (req, reply) => {
    const ctx = resolveContext(req); requireRole(ctx, ADMIN);
    const body = z.object({
      name: z.string().min(1).max(200),
      sourceType: z.enum(SOURCE_TYPES),
      url: z.string().url().max(2048),
      styleJson: z.record(z.unknown()).optional(),
      zIndex: z.number().int().min(0).max(10000).default(0),
      visible: z.boolean().default(true),
    }).parse(req.body);
    const layer = await repo.create(ctx.tenantId, ctx.actorId, { id: randomUUID(), ...body });
    return reply.code(201).send({ data: layer });
  });

  app.patch("/v1/locations/map-layers/:id", async (req, reply) => {
    const ctx = resolveContext(req); requireRole(ctx, ADMIN);
    const { id } = z.object({ id: z.string().uuid() }).parse(req.params);
    const body = z.object({
      name: z.string().min(1).max(200).optional(),
      sourceType: z.enum(SOURCE_TYPES).optional(),
      url: z.string().url().max(2048).optional(),
      styleJson: z.record(z.unknown()).nullable().optional(),
      zIndex: z.number().int().min(0).max(10000).optional(),
      visible: z.boolean().optional(),
    }).parse(req.body);
    const updated = await repo.patch(id, ctx.tenantId, body);
    if (!updated) throw new HttpError(404, "NOT_FOUND", "map layer not found");
    return reply.send({ data: updated });
  });

  app.delete("/v1/locations/map-layers/:id", async (req, reply) => {
    const ctx = resolveContext(req); requireRole(ctx, ADMIN);
    const { id } = z.object({ id: z.string().uuid() }).parse(req.params);
    const n = await repo.remove(id, ctx.tenantId);
    if (n === 0) throw new HttpError(404, "NOT_FOUND", "map layer not found");
    return reply.send({ data: { id, status: "deleted" } });
  });

  app.setErrorHandler((err, req, reply) => {
    const cid = (req.headers["x-correlation-id"] as string) ?? req.id;
    if (err instanceof ZodError) return reply.code(400).send({ code: "VALIDATION_FAILED", message: "invalid request", correlationId: cid });
    if (err instanceof HttpError) return reply.code(err.status).send({ code: err.code, message: err.message, correlationId: cid });
    req.log.error({ err }, "unhandled"); return reply.code(500).send({ code: "INTERNAL", message: "internal error", correlationId: cid });
  });
}
