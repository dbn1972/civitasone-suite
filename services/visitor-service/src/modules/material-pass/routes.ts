/**
 * visitor-service: material-pass HTTP routes.
 *
 * Follows the established blacklist/routes.ts pattern:
 *   resolveContext → requireRole → zod validate → command publish / repo read → reply
 *
 * Routes:
 *   POST /v1/visitor/material-passes      — create material pass items (202 Accepted)
 *   GET  /v1/visitor/material-passes/:passId — read material pass items by pass id
 *
 * Requirements: 13.1, 13.5
 */
import type { FastifyInstance } from "fastify";
import { resolveContext, requireRole, HttpError } from "../../shared/context.js";
import { materialPassCreateBody, idParam } from "./validators.js";
import * as repo from "./repo.js";
import * as commands from "./commands.js";

const READ_ROLES = ["security_admin", "security_guard", "front_desk", "employee", "tenant_admin", "super_admin"];
const WRITE_ROLES = ["security_admin", "security_guard", "front_desk", "tenant_admin", "super_admin"];

export async function materialPassRoutes(app: FastifyInstance): Promise<void> {
  app.post("/v1/visitor/material-passes", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, WRITE_ROLES);
    const body = materialPassCreateBody.parse(req.body);
    const accepted = await commands.materialPassCreate(ctx, {
      passId: body.passId,
      locationId: body.locationId,
      items: body.items.map((item) => ({
        description: item.description,
        quantity: item.quantity,
        serialNumber: item.serialNumber ?? null,
      })),
    });
    return reply.code(202).send({ data: accepted });
  });

  app.get("/v1/visitor/material-passes/:passId", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, READ_ROLES);
    const { passId } = idParam.parse(req.params);
    const rows = await repo.getMaterialPassesByPassId(ctx.tenantId, passId);
    if (rows.length === 0) throw new HttpError(404, "NOT_FOUND", "material pass not found");
    return reply.send({ data: rows });
  });
}
