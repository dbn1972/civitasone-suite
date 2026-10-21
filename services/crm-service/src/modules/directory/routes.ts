/**
 * CRM staff directory - the pickers behind task escalation and assignment.
 *
 *   GET /v1/crm/directory/users   - the tenant's ACTIVE users as { id, name }
 *   GET /v1/crm/directory/roles   - the tenant's ACTIVE roles as { key, label }
 *
 * The web used to fill these pickers from identity-service's `identity/users` and
 * policy-service's `policy/roles`, both of which are gated to platform/tenant admins. A
 * `crm_admin` who is not also a tenant admin therefore got EMPTY pickers (so no manager could
 * ever be chosen), and a `crm_user` team lead could not reassign an overdue task. These routes
 * answer the same question for CRM roles, over the established service-to-service path, and
 * return the minimum a picker needs - never email, status or MFA state.
 *
 * Read-only. A directory that cannot be read answers 503 (never an empty list presented as
 * fact), so a picker can say "unavailable" instead of "nobody to choose from".
 */
import type { FastifyInstance } from "fastify";
import { resolveContext, requireRole, HttpError } from "../../shared/context.js";
import { listDirectoryUsers, listDirectoryRoles } from "../../shared/user-directory.js";

/**
 * Anyone who can work CRM tasks may pick a colleague (reassign, assign).
 *
 * OWNER SIGN-OFF PENDING: this lets a plain `crm_user` list the name of every ACTIVE staff
 * member of the tenant (id + name only), which is wider than the admin-only identity listing
 * it replaced. It is the behaviour the reassign / assign pickers were built on, so it is kept
 * until the owner decides; narrowing it means taking `crm_user` out of this list.
 */
const USER_PICKER_ROLES = ["crm_user", "crm_admin", "super_admin", "tenant_admin"];
/** Roles are only needed to configure escalation rules, which is admin-only. */
const ROLE_PICKER_ROLES = ["crm_admin", "super_admin", "tenant_admin"];

export async function directoryRoutes(app: FastifyInstance): Promise<void> {
  app.get(
    "/v1/crm/directory/users",
    { config: { rateLimit: { max: 60, timeWindow: "1 minute" } } },
    async (req, reply) => {
      const ctx = resolveContext(req);
      requireRole(ctx, USER_PICKER_ROLES);
      const list = await listDirectoryUsers(ctx.tenantId);
      if (list === undefined) throw new HttpError(503, "DIRECTORY_UNAVAILABLE", "the user directory is unavailable; try again");
      // `truncated`: more users exist than were read, so a missing name proves nothing.
      return reply.send({ data: list.users, meta: { total: list.users.length, truncated: list.truncated } });
    },
  );

  app.get(
    "/v1/crm/directory/roles",
    { config: { rateLimit: { max: 60, timeWindow: "1 minute" } } },
    async (req, reply) => {
      const ctx = resolveContext(req);
      requireRole(ctx, ROLE_PICKER_ROLES);
      const roles = await listDirectoryRoles(ctx.tenantId);
      if (roles === undefined) throw new HttpError(503, "DIRECTORY_UNAVAILABLE", "the role directory is unavailable; try again");
      return reply.send({ data: roles, meta: { total: roles.length } });
    },
  );
}
