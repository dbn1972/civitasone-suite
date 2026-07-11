/**
 * visitor-service: recurring-pass HTTP routes.
 *
 * Three write-only POST endpoints following the standard CQRS pattern:
 * route → resolveContext → requireRole → zod validate body → publish command → 202 Accepted.
 *
 * Requirement 12.1: recurring pass creation (max 90-day validity, permitted days/time window).
 * Requirement 12.4: suspend/revoke — consumer updates Redis revocation set
 * (effective within 30s at all gate terminals).
 */
import type { FastifyInstance } from "fastify";
import { resolveContext, requireRole } from "../../shared/context.js";
import { recurringPassCreateBody, recurringPassSuspendBody, recurringPassRevokeBody, idParam } from "./validators.js";
import * as commands from "./commands.js";

const WRITE_ROLES = ["receptionist", "security_admin", "tenant_admin", "super_admin"];

export async function recurringPassRoutes(app: FastifyInstance): Promise<void> {
  // ── Create ────────────────────────────────────────────────────────────────
  app.post("/v1/visitor/recurring-passes", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, WRITE_ROLES);
    const body = recurringPassCreateBody.parse(req.body);

    const accepted = await commands.recurringPassCreate(ctx, {
      locationId: body.locationId,
      visitorName: body.visitorName,
      visitorPhone: body.visitorPhone,
      ...(body.companyName !== undefined ? { companyName: body.companyName } : {}),
      validFrom: body.validFrom,
      validUntil: body.validUntil,
      permittedDays: body.permittedDays,
      ...(body.permittedTimeFrom !== undefined ? { permittedTimeFrom: body.permittedTimeFrom } : {}),
      ...(body.permittedTimeTo !== undefined ? { permittedTimeTo: body.permittedTimeTo } : {}),
    });

    return reply.code(202).send({ data: accepted });
  });

  // ── Suspend ───────────────────────────────────────────────────────────────
  app.post("/v1/visitor/recurring-passes/:id/suspend", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, WRITE_ROLES);
    const { id } = idParam.parse(req.params);
    const body = recurringPassSuspendBody.parse(req.body);

    const accepted = await commands.recurringPassSuspend(ctx, {
      passId: id,
      reason: body.reason,
    });

    return reply.code(202).send({ data: accepted });
  });

  // ── Revoke ────────────────────────────────────────────────────────────────
  app.post("/v1/visitor/recurring-passes/:id/revoke", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, WRITE_ROLES);
    const { id } = idParam.parse(req.params);
    const body = recurringPassRevokeBody.parse(req.body);

    const accepted = await commands.recurringPassRevoke(ctx, {
      passId: id,
      ...(body.reason !== undefined ? { reason: body.reason } : {}),
    });

    return reply.code(202).send({ data: accepted });
  });
}
