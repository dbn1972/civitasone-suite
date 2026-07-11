/**
 * visitor-service: group-visit HTTP routes.
 *
 * Two write-only endpoints following the standard CQRS pattern:
 * route → resolveContext → requireRole → zod validate body → publish command → 202 Accepted.
 *
 * Requirement 9.1: group visit creation (2–200 members, per-member blacklist screening
 * happens asynchronously in the consumer).
 * Requirement 9.6: bulk check-in with headcount confirmation at gate.
 */
import type { FastifyInstance } from "fastify";
import { resolveContext, requireRole } from "../../shared/context.js";
import { groupVisitCreateBody, groupBulkCheckInBody, idParam } from "./validators.js";
import * as commands from "./commands.js";

const WRITE_ROLES = ["receptionist", "security_admin", "tenant_admin", "super_admin"];

export async function groupVisitRoutes(app: FastifyInstance): Promise<void> {
  app.post("/v1/visitor/group-visits", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, WRITE_ROLES);
    const body = groupVisitCreateBody.parse(req.body);

    const accepted = await commands.groupVisitCreate(ctx, {
      groupName: body.groupName,
      purpose: body.purpose,
      locationId: body.locationId,
      hostEmployeeId: body.hostEmployeeId,
      leadVisitorName: body.leadVisitorName,
      leadVisitorPhone: body.leadVisitorPhone,
      ...(body.leadVisitorEmail !== undefined ? { leadVisitorEmail: body.leadVisitorEmail } : {}),
      ...(body.leadVisitorDocType !== undefined ? { leadVisitorDocType: body.leadVisitorDocType } : {}),
      ...(body.leadVisitorDocNumber !== undefined ? { leadVisitorDocNumber: body.leadVisitorDocNumber } : {}),
      members: body.members.map((m) => ({
        name: m.name,
        ...(m.identityDocType !== undefined ? { identityDocType: m.identityDocType } : {}),
        ...(m.identityDocNumber !== undefined ? { identityDocNumber: m.identityDocNumber } : {}),
      })),
      ...(body.scheduledAt !== undefined ? { scheduledAt: body.scheduledAt } : {}),
      ...(body.passType !== undefined ? { passType: body.passType } : {}),
      ...(body.permittedAreas !== undefined ? { permittedAreas: body.permittedAreas } : {}),
    });

    return reply.code(202).send({ data: accepted });
  });

  app.post("/v1/visitor/group-visits/:id/bulk-checkin", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, WRITE_ROLES);
    const { id } = idParam.parse(req.params);
    const body = groupBulkCheckInBody.parse(req.body);

    const accepted = await commands.groupBulkCheckIn(ctx, {
      groupVisitId: id,
      actualHeadcount: body.actualHeadcount,
      ...(body.gateId !== undefined ? { gateId: body.gateId } : {}),
    });

    return reply.code(202).send({ data: accepted });
  });
}
