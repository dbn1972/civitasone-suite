import type { FastifyInstance } from "fastify";
import { z, ZodError } from "zod";
import { resolveContext, requireRole, HttpError } from "../../shared/context.js";
import { cache } from "../../shared/infra.js";
const READER = ["super_admin", "location_admin", "project_admin"];
export async function spatialRoutes(app: FastifyInstance): Promise<void> {
  app.post("/v1/locations/spatial/within-radius", async (req, reply) => {
    const ctx = resolveContext(req); requireRole(ctx, READER);
    const body = z.object({ lat: z.number(), lng: z.number(), radiusKm: z.number().positive() }).parse(req.body);
    const key = cache.makeKey(ctx.tenantId, "spatial_radius", `${body.lat}_${body.lng}_${body.radiusKm}`);
    const data = await cache.getOrLoad(key, async () => []);
    return reply.send({ data });
  });
  app.post("/v1/locations/spatial/within-polygon", async (req, reply) => {
    const ctx = resolveContext(req); requireRole(ctx, READER);
    const body = z.object({ polygon: z.array(z.object({ lat: z.number(), lng: z.number() })).min(3) }).parse(req.body);
    const key = cache.makeKey(ctx.tenantId, "spatial_polygon", String(body.polygon.length));
    const data = await cache.getOrLoad(key, async () => []);
    return reply.send({ data });
  });
  app.get("/v1/locations/spatial/clusters", async (req, reply) => {
    const ctx = resolveContext(req); requireRole(ctx, READER);
    const data = await cache.getOrLoad(cache.makeKey(ctx.tenantId, "spatial_clusters", "all"), async () => []);
    return reply.send({ data });
  });
  app.setErrorHandler((err, req, reply) => {
    const cid = (req.headers["x-correlation-id"] as string) ?? req.id;
    if (err instanceof ZodError) return reply.code(400).send({ code: "VALIDATION_FAILED", message: "invalid request", correlationId: cid });
    if (err instanceof HttpError) return reply.code(err.status).send({ code: err.code, message: err.message, correlationId: cid });
    req.log.error({ err }, "unhandled"); return reply.code(500).send({ code: "INTERNAL", message: "internal error", correlationId: cid });
  });
}
