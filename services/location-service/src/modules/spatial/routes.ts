import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { registerSchemaErrorHandler } from "@civitasone/schemas/plugin";
import { resolveContext, requireRole, HttpError } from "../../shared/context.js";
import * as repo from "./repo.js";

const READER = ["super_admin", "location_admin", "project_admin", "location_user"];

export async function spatialRoutes(app: FastifyInstance): Promise<void> {
  // SVC-118: real PostGIS ST_DWithin (was a [] stub).
  app.post("/v1/locations/spatial/within-radius", async (req, reply) => {
    const ctx = resolveContext(req); requireRole(ctx, READER);
    const body = z.object({
      lat: z.number().min(-90).max(90),
      lng: z.number().min(-180).max(180),
      radiusKm: z.number().positive().max(20000),
      limit: z.number().int().min(1).max(1000).optional(),
    }).parse(req.body);
    const data = await repo.withinRadius(ctx.tenantId, body.lat, body.lng, body.radiusKm, body.limit ?? 200);
    return reply.send({ data, meta: { total: data.length } });
  });

  // SVC-118: real PostGIS ST_Within against a GeoJSON polygon (was a [] stub).
  app.post("/v1/locations/spatial/within-polygon", async (req, reply) => {
    const ctx = resolveContext(req); requireRole(ctx, READER);
    const body = z.object({
      polygon: z.array(z.object({ lat: z.number().min(-90).max(90), lng: z.number().min(-180).max(180) })).min(3).max(1000),
      limit: z.number().int().min(1).max(1000).optional(),
    }).parse(req.body);
    const data = await repo.withinPolygon(ctx.tenantId, body.polygon, body.limit ?? 500);
    return reply.send({ data, meta: { total: data.length } });
  });

  // SVC-118: real PostGIS ST_ClusterKMeans (was a [] stub).
  app.get("/v1/locations/spatial/clusters", async (req, reply) => {
    const ctx = resolveContext(req); requireRole(ctx, READER);
    const q = z.object({ k: z.coerce.number().int().min(1).max(50).optional() }).parse(req.query);
    const data = await repo.clusters(ctx.tenantId, q.k ?? 5);
    return reply.send({ data, meta: { total: data.length } });
  });

  // Shared envelope: ZodError->400, HttpError, malformed JSON->400 MALFORMED_BODY, Fastify 4xx passthrough (a local
  // copy missed JSON parse errors and answered 500).
  registerSchemaErrorHandler(app, HttpError);
}
