import type { FastifyInstance } from "fastify";
import { resolveContext, requireRole, HttpError } from "../../shared/context.js";
import { createLocationBody, createAreaBody, idParam } from "./validators.js";
import type { BusinessHours } from "./schema.js";
import * as repo from "./repo.js";
import * as commands from "./commands.js";

// Locations/areas/gates/parking are admin-managed reference/configuration
// data. Task Q-95.1 moved the location/area create writes onto the same
// queue-first CQRS convention (route -> zod validate -> publish -> 202)
// used by every other mutating module (see ./commands.ts + ./consumer.ts);
// reads go through the read-only roles below and writes are gated to the
// admin-tier roles that configure premises security in the design (VIP
// module already establishes `security_admin`/`protocol_officer` as
// visitor-service staff roles; `tenant_admin`/`super_admin` are the
// platform-wide admin tiers per the CivitasOne role convention).
const READ_ROLES = ["employee", "security_admin", "protocol_officer", "tenant_admin", "super_admin"];
const WRITE_ROLES = ["security_admin", "tenant_admin", "super_admin"];

export async function locationRoutes(app: FastifyInstance): Promise<void> {
  app.get("/v1/visitor/locations", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, READ_ROLES);
    const rows = await repo.listLocations(ctx.tenantId);
    return reply.send({ data: rows });
  });

  app.post("/v1/visitor/locations", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, WRITE_ROLES);
    const body = createLocationBody.parse(req.body);
    // zod's inferred optional-boolean fields carry an explicit `| undefined`
    // arm (exactOptionalPropertyTypes-incompatible with the plain-optional
    // `BusinessHours` type from schema.ts), so re-assert the validated shape.
    // Task Q-95.1: queue-first CQRS write (route -> zod validate -> publish
    // -> 202), matching the convention used by every other mutating module.
    const accepted = await commands.locationCreate(ctx, {
      ...body,
      businessHours: body.businessHours as BusinessHours,
    });
    return reply.code(202).send({ data: accepted });
  });

  app.get("/v1/visitor/locations/:id/areas", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, READ_ROLES);
    const { id } = idParam.parse(req.params);
    const location = await repo.getLocationById(ctx.tenantId, id);
    if (!location) throw new HttpError(404, "NOT_FOUND", "location not found");
    const rows = await repo.listAreas(ctx.tenantId, id);
    return reply.send({ data: rows });
  });

  app.post("/v1/visitor/locations/:id/areas", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, WRITE_ROLES);
    const { id } = idParam.parse(req.params);
    const location = await repo.getLocationById(ctx.tenantId, id);
    if (!location) throw new HttpError(404, "NOT_FOUND", "location not found");
    const body = createAreaBody.parse(req.body);
    // Task Q-95.1: queue-first CQRS write, see the POST /locations comment above.
    const accepted = await commands.areaCreate(ctx, id, body);
    return reply.code(202).send({ data: accepted });
  });

  app.get("/v1/visitor/locations/:id/parking", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, READ_ROLES);
    const { id } = idParam.parse(req.params);
    const location = await repo.getLocationById(ctx.tenantId, id);
    if (!location) throw new HttpError(404, "NOT_FOUND", "location not found");
    const rows = await repo.listParkingSlots(ctx.tenantId, id);
    return reply.send({ data: rows });
  });
}
