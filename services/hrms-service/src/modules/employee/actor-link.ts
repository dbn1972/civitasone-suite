import type { FastifyRequest } from "fastify";
import { eq, and } from "drizzle-orm";
import { scopedRead, db } from "../../shared/db.js";
import { hrmsEmployees, type EmployeeRow } from "./schema.js";

/**
 * Extract email from the decoded JWT payload attached by authPlugin, falling
 * back to the x-user-email header the gateway forwards (authPlugin itself
 * only decorates req.ctx, not req.jwtPayload — the jwtPayload check exists
 * for topologies that attach it directly; in practice the gateway-forwarded
 * header is what's populated today).
 */
export function extractActorEmail(req: FastifyRequest): string | undefined {
  const raw = (req as unknown as { jwtPayload?: { email?: string } }).jwtPayload;
  if (raw?.email) return raw.email;
  const hdr = req.headers["x-user-email"];
  return typeof hdr === "string" ? hdr : undefined;
}

/**
 * Resolve the hrmsEmployees row linked to a request's actor.
 *
 * Primary: userRef = actorId. Fallback (only when not yet linked): match by
 * email from the JWT/gateway header and auto-link userRef for next time —
 * solves the bootstrap problem where employees are seeded/onboarded without
 * user_ref populated.
 *
 * Single source of truth for actor->employee resolution: shared by
 * self-service routes' "my profile" family and leave's apply-on-behalf-of
 * ownership/reporting-line checks, so a not-yet-linked employee gets the
 * same auto-link behavior (and the same non-403 outcome) everywhere instead
 * of only wherever happened to call /me/profile first.
 */
export async function resolveEmployeeForActor(
  tenantId: string,
  actorId: string,
  email: string | undefined,
): Promise<EmployeeRow | undefined> {
  let rows = await scopedRead((tx) => tx.select().from(hrmsEmployees)
    .where(and(eq(hrmsEmployees.tenantId, tenantId), eq(hrmsEmployees.userRef, actorId))));
  let emp = rows[0];

  if (!emp && email) {
    rows = await scopedRead((tx) => tx.select().from(hrmsEmployees)
      .where(and(eq(hrmsEmployees.tenantId, tenantId), eq(hrmsEmployees.email, email))));
    emp = rows[0];
    if (emp) {
      // Auto-link userRef so future lookups (here and elsewhere) are fast
      // and don't depend on this email-fallback path again. Must run inside
      // db.transaction (not a bare db.update()) so wrapWithTenantGuc sets
      // app.tenant_id for the write — a bare call runs on a pooled connection
      // with no GUC set, and under the NOBYPASSRLS service role the
      // fail-closed RLS policy silently matches zero rows (the same
      // "RLS inert at runtime" trap payroll's createRun() duplicate-run guard
      // hit on the read side — see that function's BUG-3 comment).
      const empId = emp.id;
      await db.transaction(async (tx) => {
        await tx.update(hrmsEmployees)
          .set({ userRef: actorId })
          .where(and(eq(hrmsEmployees.id, empId), eq(hrmsEmployees.tenantId, tenantId)));
      });
    }
  }
  return emp;
}
