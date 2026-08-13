import type { FastifyInstance } from "fastify";
import { ZodError } from "zod";
import { listQuerySchema, acceptedResponseSchema } from "@civitasone/schemas/common";
import { sendValidated, sendAccepted } from "@civitasone/schemas/validate";
import { resolveContext, requireRole, HttpError } from "../../shared/context.js";
import { createLocationBody, updateLocationBody, idParam, locationsListSchema, locationTreeSchema, nearbyQuerySchema } from "./validators.js";
import * as commands from "./commands.js";
import * as queries from "./queries.js";
import * as repo from "./repo.js";
import { cache } from "../../shared/infra.js";
import { RESOURCE } from "../../topics.js";

const LOCATION_ROLES = ["location_user", "location_admin", "super_admin", "admin", "hr_admin"];

export async function locationRoutes(app: FastifyInstance): Promise<void> {
  app.post("/v1/locations", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, LOCATION_ROLES);
    const body = createLocationBody.parse(req.body);
    // Hierarchy rule: a supplied parent must exist within the same tenant.
    if (body.parentId) {
      const parent = await queries.getLocation(body.parentId, ctx.tenantId);
      if (!parent) {
        throw new HttpError(
          400,
          "INVALID_PARENT",
          "The selected parent office does not exist or belongs to another organisation."
        );
      }
    }
    sendAccepted(reply, acceptedResponseSchema, await commands.createLocation(ctx, body));
  });

  app.get("/v1/locations", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, LOCATION_ROLES);
    const q = listQuerySchema.parse(req.query);
    sendValidated(reply, locationsListSchema, await queries.listLocations(ctx.tenantId, q.limit, q.offset));
  });

  app.get("/v1/locations/tree", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, LOCATION_ROLES);
    sendValidated(reply, locationTreeSchema, await queries.getLocationTree(ctx.tenantId));
  });

  app.get("/v1/locations/nearby", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, LOCATION_ROLES);
    const { lat, lng, radiusKm, limit } = nearbyQuerySchema.parse(req.query);
    const result = await queries.findNearby(ctx.tenantId, lat, lng, radiusKm, limit);
    return reply.send(result);
  });

  // Sample data ("try it"): add clearly-marked example offices, or clear them.
  // Tenant-scoped; clearing removes ONLY this tenant's sample rows (R15).
  app.post("/v1/locations/sample-data", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, LOCATION_ROLES);
    const added = await repo.seedSamples(ctx.tenantId, ctx.actorId);
    await cache.invalidateResource(ctx.tenantId, RESOURCE);
    return reply.send({ added });
  });

  app.delete("/v1/locations/sample-data", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, LOCATION_ROLES);
    const removed = await repo.clearSamples(ctx.tenantId);
    await cache.invalidateResource(ctx.tenantId, RESOURCE);
    return reply.send({ removed });
  });

  app.get("/v1/locations/:id", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, LOCATION_ROLES);
    const { id } = idParam.parse(req.params);
    const location = await queries.getLocation(id, ctx.tenantId);
    if (!location) throw new HttpError(404, "NOT_FOUND", "location not found");
    return reply.send(location);
  });


  app.patch("/v1/locations/:id", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, LOCATION_ROLES);
    const { id } = idParam.parse(req.params);
    const existing = await queries.getLocation(id, ctx.tenantId);
    if (!existing) throw new HttpError(404, "NOT_FOUND", "location not found");
    const body = updateLocationBody.parse(req.body);
    sendAccepted(reply, acceptedResponseSchema, await commands.updateLocation(ctx, id, body));
  });

  app.setErrorHandler((err, req, reply) => {
    const correlationId = (req.headers["x-correlation-id"] as string) ?? req.id;
    if (err instanceof ZodError) {
      return reply.code(400).send({
        code: "VALIDATION_FAILED",
        message: "invalid request",
        correlationId,
        retryable: false,
        fieldErrors: err.issues.map((i) => ({ field: i.path.join("."), message: i.message })),
      });
    }
    if (err instanceof HttpError) {
      return reply.code(err.status).send({ code: err.code, message: err.message, correlationId, retryable: false });
    }
    req.log.error({ err }, "unhandled error");
    return reply.code(500).send({ code: "INTERNAL", message: "internal error", correlationId, retryable: true });
  });
}
