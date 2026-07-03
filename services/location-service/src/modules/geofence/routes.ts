import type { FastifyInstance } from "fastify";
import { listQuerySchema, acceptedResponseSchema } from "@civitasone/schemas/common";
import { sendValidated, sendAccepted } from "@civitasone/schemas/validate";
import { resolveContext, requireRole, HttpError } from "../../shared/context.js";
import { createGeofenceBody, updateGeofenceBody, geofenceCheckBody, idParam, geofencesListSchema, haversineDistance, pointInPolygon } from "./validators.js";
import * as commands from "./commands.js";
import * as repo from "./repo.js";
import { cache } from "../../shared/infra.js";
import { RESOURCES } from "../../topics.js";

const GEOFENCE_ROLES = ["location_user", "location_admin", "super_admin", "admin"];

export async function geofenceRoutes(app: FastifyInstance): Promise<void> {
  app.get("/v1/geofences", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, GEOFENCE_ROLES);
    const q = listQuerySchema.parse(req.query);
    const data = await repo.listByTenant(ctx.tenantId, q.limit, q.offset);
    return reply.send({ data, pagination: { hasMore: data.length === q.limit, pageSize: q.limit } });
  });

  app.post("/v1/geofences", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, GEOFENCE_ROLES);
    const body = createGeofenceBody.parse(req.body);
    sendAccepted(reply, acceptedResponseSchema, await commands.geofenceCreate(ctx, body));
  });

  app.put("/v1/geofences/:id", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, GEOFENCE_ROLES);
    const { id } = idParam.parse(req.params);
    const body = updateGeofenceBody.parse(req.body);
    const existing = await repo.findById(id, ctx.tenantId);
    if (!existing) throw new HttpError(404, "NOT_FOUND", "geofence not found");
    sendAccepted(reply, acceptedResponseSchema, await commands.geofenceUpdate(ctx, id, body));
  });

  app.get("/v1/geofences/:id", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, GEOFENCE_ROLES);
    const { id } = idParam.parse(req.params);
    const geofence = await cache.getOrLoad(
      cache.makeKey(ctx.tenantId, RESOURCES.geofence, id),
      () => repo.findById(id, ctx.tenantId),
    );
    if (!geofence) throw new HttpError(404, "NOT_FOUND", "geofence not found");
    return reply.send(geofence);
  });

  /**
   * Synchronous check: lat/lng → inside/outside for a specific geofence.
   * Returns immediately (no queue) since this is a read operation used for
   * real-time attendance/asset tracking.
   */
  app.post("/v1/geofences/:id/check", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, GEOFENCE_ROLES);
    const { id } = idParam.parse(req.params);
    const body = geofenceCheckBody.parse(req.body);

    const geofence = await cache.getOrLoad(
      cache.makeKey(ctx.tenantId, RESOURCES.geofence, id),
      () => repo.findById(id, ctx.tenantId),
    );
    if (!geofence) throw new HttpError(404, "NOT_FOUND", "geofence not found");

    const distance = haversineDistance(body.lat, body.lng, geofence.centerLat, geofence.centerLng);
    let inside = distance <= geofence.radiusMeters;

    // If polygon is defined, use polygon-based check
    if (geofence.polygon && geofence.polygon.length >= 3) {
      inside = pointInPolygon(body.lat, body.lng, geofence.polygon);
    }

    return reply.send({
      geofenceId: id,
      inside,
      distanceMeters: Math.round(distance),
    });
  });
}
