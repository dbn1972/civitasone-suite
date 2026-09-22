import type { FastifyInstance } from "fastify";
import * as repo from "./repo.js";

/**
 * Bug fix (raw-id-leaked-to-ui): procurement-service's Purchase Indents list
 * had no way to resolve an indent's createdBy (a raw Keycloak/identity user
 * uuid -- there is no requester_id/requester_name column anywhere in
 * indent.procurement_indents, see schema.ts) into an actual person's name,
 * so the frontend fell back to slicing the first 8 chars of that uuid and
 * showing it as "Requested By" -- for every seeded indent that id happened
 * to start with "00000000", so every row showed the literal string
 * "00000000" instead of a name.
 *
 * This is the same shape of gap fetchEmployeeSummaries (hrms-service's
 * internal/routes.ts) already closes for payroll/estab -- a display-only,
 * best-effort, low-PII id->name lookup for another service to enrich a list
 * with, over the service's existing x-internal + x-service-secret +
 * x-tenant-id internal-elevation path (packages/auth/src/plugin.ts). No
 * additional preHandler is needed here: that global onRequest hook already
 * verifies x-service-secret against INTERNAL_SERVICE_SECRET before this
 * handler runs (see apikeys/internal-routes.ts for the OTHER internal-auth
 * mechanism in this codebase -- x-gateway-request, for gateway-initiated
 * calls specifically; this route is peer-service-to-service, so it uses the
 * same mechanism hrms-client.ts / payroll-client.ts already rely on).
 *
 * Deliberately returns only {id, name} -- not email/empCode/status/
 * mfaEnabled -- the caller only ever needs a display label, and the
 * internal boundary should not leak more than that (same minimization
 * reasoning as fetchEmployeeSummaries's own doc comment).
 */
export async function userInternalRoutes(app: FastifyInstance): Promise<void> {
  app.get("/identity/internal/user-summaries", async (req, reply) => {
    const headers = req.headers as Record<string, string>;
    const tenantId = headers["x-tenant-id"] ?? "";
    if (!tenantId) return reply.code(400).send({ code: "MISSING_TENANT" });
    const users = await repo.findByTenantId(tenantId, 2000, 0);
    return reply.send(users.map((u) => ({ id: u.id, name: u.name })));
  });
}
