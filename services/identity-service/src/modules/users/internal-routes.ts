import type { FastifyInstance } from "fastify";
import { z, ZodError } from "zod";
import { resolveContext, requireRole, HttpError } from "../../shared/context.js";
import * as repo from "./repo.js";

const INTERNAL_ROLES = ["super_admin"];

export async function userInternalRoutes(app: FastifyInstance): Promise<void> {
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
  app.get("/identity/internal/user-summaries", async (req, reply) => {
    const headers = req.headers as Record<string, string>;
    const tenantId = headers["x-tenant-id"] ?? "";
    if (!tenantId) return reply.code(400).send({ code: "MISSING_TENANT" });
    const users = await repo.findByTenantId(tenantId, 2000, 0);
    return reply.send(users.map((u) => ({ id: u.id, name: u.name })));
  });

  /**
   * SEC fix (self-service identity hijack in hrms-service): returns EXACTLY
   * one user's own verified email, scoped to ctx.tenantId. Added so
   * hrms-service (and payroll-service, transitively via hrms-service's own
   * internal actor/resolve route) can stop trusting a client-supplied
   * x-user-email HTTP header to auto-link an employee record to a caller's
   * userRef -- see hrms-service's employee/actor-link.ts
   * (resolveEmployeeForActor) and shared/identity-client.ts
   * (fetchVerifiedActorEmail) for the full writeup of the vulnerability this
   * closes and how this endpoint is used.
   *
   * The lookup key is the target user's id, but every real caller passes
   * ONLY its own already-JWT-verified actorId here (never one derived from
   * anything the original end user supplied) -- there is no request shape
   * on the calling side that lets an end user pick which id gets queried.
   *
   * Gated by resolveContext + requireRole(INTERNAL_ROLES), unlike
   * /user-summaries above (which predates this fix and reads
   * req.headers["x-tenant-id"] directly with no role check): this endpoint
   * returns a real, targeted PII field (one user's email) rather than a bulk
   * display name, so it deliberately uses the stricter, already-proven-safe
   * gate hrms-service's own /v1/hrms/internal/employee-summaries fix
   * established (see that route's "HIGH security fix" comment) -- only a
   * genuine x-internal-elevated caller (or a real super_admin) can reach it,
   * scoped to ctx.tenantId rather than a client-supplied header.
   */
  app.get("/identity/internal/users/:id/email", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, INTERNAL_ROLES);
    const { id } = z.object({ id: z.string().uuid() }).parse(req.params);
    const user = await repo.findById(ctx.tenantId, id);
    if (!user) return reply.code(404).send({ code: "NOT_FOUND" });
    return reply.send({ id: user.id, email: user.email });
  });

  app.setErrorHandler((err, req, reply) => {
    const correlationId = (req.headers["x-correlation-id"] as string) ?? req.id;
    if (err instanceof ZodError) {
      return reply.code(400).send({ code: "VALIDATION_FAILED", message: "invalid request", correlationId, fieldErrors: err.issues.map((i) => ({ field: i.path.join("."), message: i.message })) });
    }
    if (err instanceof HttpError) {
      return reply.code(err.status).send({ code: err.code, message: err.message, correlationId });
    }
    req.log.error({ err }, "unhandled error");
    return reply.code(500).send({ code: "INTERNAL", message: "internal error", correlationId });
  });
}
