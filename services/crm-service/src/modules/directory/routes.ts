/**
 * CRM staff directory - the pickers behind task escalation and assignment.
 *
 *   GET /v1/crm/directory/users   - the tenant's ACTIVE users as { id, name }; `?q=` (2+ characters)
 *                                   searches by name on the server and reaches users the plain
 *                                   list's bound (meta.truncated) leaves out
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
import type { FastifyInstance, FastifyRequest } from "fastify";
import { z } from "zod";
import { resolveContext, requireRole, HttpError } from "../../shared/context.js";
import {
  listDirectoryUsers,
  listDirectoryRoles,
  searchDirectoryUsers,
  USER_SEARCH_MIN_CHARS,
  USER_SEARCH_LIMIT,
} from "../../shared/user-directory.js";

/** A control character (C0 range or DEL): never part of a person's name, and a NUL would only make identity answer 400/500. */
function hasControlChar(v: string): boolean {
  for (const ch of v) {
    const c = ch.charCodeAt(0);
    if (c < 0x20 || c === 0x7f) return true;
  }
  return false;
}

/**
 * `?q=` narrows the picker to people whose NAME matches (server-side, so it reaches past the browse cap).
 * Control characters are refused here with a 400, so they never travel on to identity-service, where
 * they would surface as a misleading 503 "directory unavailable".
 */
const usersQuery = z.object({
  q: z
    .string()
    .trim()
    .min(USER_SEARCH_MIN_CHARS)
    .max(100)
    .refine((v) => !hasControlChar(v), { message: "q must not contain control characters" })
    .optional(),
});

/**
 * Anyone who can work CRM tasks may pick a colleague (reassign, assign).
 *
 * OWNER DECISION PENDING (recorded in docs/gap-ledger/crm.md, branch notes): this lets a plain
 * `crm_user` list the name of every ACTIVE staff member of the tenant -- and search them by name --
 * which is wider than the admin-only identity listing it replaced. The response is limited to
 * `id` + display name (see {@link pickerUser}: no email, phone, status or roles, whatever the
 * upstream returns). It is the behaviour the reassign / assign pickers were built on, so who may
 * call it is NOT changed here; narrowing it means taking `crm_user` out of this list.
 */
const USER_PICKER_ROLES = ["crm_user", "crm_admin", "super_admin", "tenant_admin"];
/** Roles are only needed to configure escalation rules, which is admin-only. */
const ROLE_PICKER_ROLES = ["crm_admin", "super_admin", "tenant_admin"];

/** The ONLY shape this endpoint returns for a person: an id and a display name, nothing else. */
function pickerUser(u: { id: string; name: string }): { id: string; name: string } {
  return { id: u.id, name: u.name };
}

/** Plain picker loads: a few per screen, so the original conservative budget stands. */
export const DIRECTORY_BROWSE_LIMIT_PER_MINUTE = 60;
/**
 * `?q=` is a type-ahead: even debounced it is a few requests per search, and the budget is per tenant + IP,
 * which on a shared office egress address is many people at once. 4x the browse budget, still below the
 * service-wide 300/min default, and counted in its OWN bucket so searching can never lock out opening a picker.
 */
export const DIRECTORY_SEARCH_LIMIT_PER_MINUTE = 240;

const isSearch = (req: FastifyRequest): boolean => {
  const q = (req.query as { q?: unknown } | undefined)?.q;
  return typeof q === "string" && q.length > 0;
};

export async function directoryRoutes(app: FastifyInstance): Promise<void> {
  app.get(
    "/v1/crm/directory/users",
    {
      config: {
        rateLimit: {
          timeWindow: "1 minute",
          max: (req: FastifyRequest) => (isSearch(req) ? DIRECTORY_SEARCH_LIMIT_PER_MINUTE : DIRECTORY_BROWSE_LIMIT_PER_MINUTE),
          // The service default key (tenant + IP), split by browse / search so the two budgets are independent.
          keyGenerator: (req: FastifyRequest) =>
            `${isSearch(req) ? "search" : "browse"}:${(req as FastifyRequest & { tenantId?: string }).tenantId ?? req.ip}:${req.ip}`,
        },
      },
    },
    async (req, reply) => {
      const ctx = resolveContext(req);
      requireRole(ctx, USER_PICKER_ROLES);
      const { q } = usersQuery.parse(req.query ?? {});
      const list = q === undefined ? await listDirectoryUsers(ctx.tenantId) : await searchDirectoryUsers(ctx.tenantId, q);
      if (list === undefined) throw new HttpError(503, "DIRECTORY_UNAVAILABLE", "the user directory is unavailable; try again");
      // `truncated`: more users exist than were read (the plain list is bounded; a search shows at
      // most USER_SEARCH_LIMIT matches), so a missing name proves nothing -- narrow the search instead.
      return reply.send({
        data: list.users.map(pickerUser),
        meta: {
          total: list.users.length,
          truncated: list.truncated,
          ...(q === undefined ? {} : { query: q, searchLimit: USER_SEARCH_LIMIT }),
        },
      });
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
