import type { FastifyInstance } from "fastify";
import { ZodError } from "zod";
import { listQuerySchema, acceptedResponseSchema } from "@civitasone/schemas/common";
import { sendValidated, sendAccepted } from "@civitasone/schemas/validate";
import { resolveContext, requireRole, HttpError } from "../../shared/context.js";
import { createLocationBody, updateLocationBody, archiveLocationBody, idParam, locationsListSchema, locationTreeSchema, nearbyQuerySchema, locationHierarchySchema } from "./validators.js";
import * as commands from "./commands.js";
import * as queries from "./queries.js";
import * as repo from "./repo.js";
import { cache } from "../../shared/infra.js";
import { wouldCreateCycle } from "./domain.js";
import { RESOURCE } from "../../topics.js";

const LOCATION_ROLES = ["location_user", "location_admin", "super_admin", "admin", "hr_admin"];

// GAP-HR-LOCATIONS-06: the web /hr layout (apps/web's hr/layout.tsx HR_ROLES)
// admits hr_officer/manager/employee to /hr/locations, which fetches GET
// /v1/locations unconditionally for whoever lands on it -- but this service
// only ever admitted LOCATION_ROLES, so those three roles got a flat 403
// turned into a generic "couldn't load" error instead of the office
// directory. A location record is low-sensitivity reference data (name,
// type, address) that any HR-context viewer can reasonably need to look up
// (e.g. picking a work location) -- read access is widened to match what
// the web layout already intends, while every mutation (create/update,
// sample-data seed/clear) stays on the original, narrower LOCATION_ROLES
// unchanged. Scoped to the one route (`GET /v1/locations`) this gap actually
// demonstrated is hit by a legitimate broader-role caller; `/tree`,
// `/nearby` and `/:id` are left as-is -- no evidence here that a non-HR
// caller of this shared service needs those widened too, and the risk of
// over-widening an authorization boundary on unverified guesswork outweighs
// closing an unconfirmed gap.
const LOCATION_VIEW_ROLES = [...LOCATION_ROLES, "hr_officer", "manager", "employee"];

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
    requireRole(ctx, LOCATION_VIEW_ROLES);
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

  // Read-only hierarchy (breadcrumb + children + descendant ids) for the HR
  // per-location employee page (GAP-HR-LOCATIONS-03) and hrms-service's
  // sub-location filter. Same low-sensitivity reference data as GET
  // /v1/locations, so the same LOCATION_VIEW_ROLES gate.
  app.get("/v1/locations/:id/hierarchy", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, LOCATION_VIEW_ROLES);
    const { id } = idParam.parse(req.params);
    const hierarchy = await queries.getLocationHierarchy(id, ctx.tenantId);
    if (!hierarchy) throw new HttpError(404, "NOT_FOUND", "location not found");
    sendValidated(reply, locationHierarchySchema, hierarchy);
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
    // Archiving has its own route (reason + active-children check). Letting it
    // through here would bypass both, so the generic edit refuses it.
    if (body.status === "archived") {
      throw new HttpError(400, "USE_ARCHIVE_ENDPOINT", "archive a location through PATCH /v1/locations/:id/archive");
    }
    // GAP-HR-LOCATIONS-02 (edit): moving a location under a new parent must
    // keep the tree a tree -- the parent has to exist in this tenant and must
    // not be the location itself or one of its own descendants.
    if (body.parentId) {
      const parent = await queries.getLocation(body.parentId, ctx.tenantId);
      if (!parent) {
        throw new HttpError(400, "INVALID_PARENT", "The selected parent office does not exist or belongs to another organisation.");
      }
      const edges = (await repo.listAllByTenant(ctx.tenantId)).map((l) => ({ id: l.id, parentId: l.parentId }));
      if (wouldCreateCycle(edges, id, body.parentId)) {
        throw new HttpError(400, "INVALID_PARENT", "A location cannot be placed under itself or one of its own sub-locations.");
      }
    }
    sendAccepted(reply, acceptedResponseSchema, await commands.updateLocation(ctx, id, body));
  });

  // GAP-HR-LOCATIONS-02: archive (soft-remove). The web "Archive" action on
  // /hr/locations and /locations/list called this path, but no such route
  // existed (404) -- and the status column's CHECK only allowed 'active'
  // (migration 0025 widens it). A location that still has non-archived
  // sub-locations cannot be archived: archive the children first, so the tree
  // never has an active node under an archived one.
  app.patch("/v1/locations/:id/archive", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, LOCATION_ROLES);
    const { id } = idParam.parse(req.params);
    const body = archiveLocationBody.parse(req.body ?? {});
    const existing = await queries.getLocation(id, ctx.tenantId);
    if (!existing) throw new HttpError(404, "NOT_FOUND", "location not found");
    if (existing.status === "archived") {
      throw new HttpError(409, "ALREADY_ARCHIVED", "this location is already archived");
    }
    const children = (await repo.listAllByTenant(ctx.tenantId)).filter((l) => l.parentId === id && l.status !== "archived");
    if (children.length > 0) {
      throw new HttpError(409, "HAS_ACTIVE_CHILDREN", `archive its ${children.length} active sub-location(s) first`);
    }
    sendAccepted(reply, acceptedResponseSchema, await commands.updateLocation(ctx, id, { status: "archived", ...(body.reason ? { reason: body.reason } : {}) }));
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
