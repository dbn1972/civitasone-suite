/**
 * visitor-service: vehicle-pass HTTP routes.
 *
 * Follows the established blacklist/routes.ts pattern:
 *   resolveContext → requireRole → zod validate → command publish → 202
 *
 * Routes:
 *   POST /v1/visitor/vehicle-passes — create vehicle pass (202 Accepted)
 *
 * Requirements: 14.1
 */
import type { FastifyInstance } from "fastify";
import { resolveContext, requireRole } from "../../shared/context.js";
import { vehiclePassCreateBody } from "./validators.js";
import * as commands from "./commands.js";

const WRITE_ROLES = ["security_admin", "security_guard", "front_desk", "employee", "tenant_admin", "super_admin"];

export async function vehiclePassRoutes(app: FastifyInstance): Promise<void> {
  app.post("/v1/visitor/vehicle-passes", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, WRITE_ROLES);
    const body = vehiclePassCreateBody.parse(req.body);
    const accepted = await commands.vehiclePassCreate(ctx, {
      passId: body.passId,
      locationId: body.locationId,
      registrationNumber: body.registrationNumber,
      vehicleType: body.vehicleType,
      visitorCategory: body.visitorCategory,
      ...(body.driverName !== undefined ? { driverName: body.driverName } : {}),
    });
    return reply.code(202).send({ data: accepted });
  });
}
