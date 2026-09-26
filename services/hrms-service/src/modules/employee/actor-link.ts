import { eq, and } from "drizzle-orm";
import { scopedRead, db } from "../../shared/db.js";
import { hrmsEmployees, type EmployeeRow } from "./schema.js";
import { fetchVerifiedActorEmail } from "../../shared/identity-client.js";

/**
 * Resolve the hrmsEmployees row linked to a request's actor.
 *
 * Primary: userRef = actorId. Fallback (only when not yet linked): match by
 * the actor's own VERIFIED email -- fetched from identity-service (the
 * Keycloak-backed source of truth) keyed by the actor's own JWT-verified
 * actorId -- and auto-link userRef for next time. Solves the bootstrap
 * problem where employees are seeded/onboarded without user_ref populated.
 *
 * SEC FIX (self-service identity hijack, live-exploit confirmed and
 * reproduced twice): this used to take `email` as a third parameter, sourced
 * by every caller from a now-deleted extractActorEmail(req) helper that read
 * the raw `x-user-email` HTTP header -- a header the gateway's STRIP_HEADERS
 * list does NOT strip (unlike x-internal/x-service-secret/x-internal-caller,
 * which it does), and which carries no verification that it corresponds to
 * the authenticated caller at all. Employee emails follow a predictable
 * <empNo>@example.gov.in pattern, so ANY authenticated employee JWT could
 * set x-user-email to a colleague's address and this function would happily
 * match that colleague's row and permanently overwrite its userRef to the
 * attacker's actorId -- a complete, repeatable self-service identity
 * takeover (a second attacker could even re-steal the link from the first).
 *
 * There was never a legitimate reason to trust that header: no JWT issued by
 * this system's Keycloak realm carries an email claim at all (see
 * packages/auth/src/index.ts's CivitasJwtPayload / toRequestContext -- sub,
 * tid, roles, sid only), and the `req.jwtPayload.email` branch
 * extractActorEmail used to check FIRST was dead code (authPlugin only ever
 * sets req.ctx, per its own module doc comment) -- so in production every
 * call fell straight through to the unauthenticated header unconditionally.
 *
 * Fixed by removing the caller-supplied email entirely and deriving it
 * server-side from identity-service, keyed ONLY by the actorId the caller
 * already authenticated via JWT verification (see shared/identity-client.ts
 * fetchVerifiedActorEmail) -- there is no parameter through which this can
 * be asked to resolve a DIFFERENT actor's email. Every call site across this
 * service (self-service/leave/apar/appraisals/medical/etc.) and the one
 * cross-service caller (payroll-service, via the
 * /v1/hrms/internal/employees/actor/:actorId/resolve internal route) shared
 * the vulnerable helper, so fixing it here closes the vulnerability
 * everywhere at once -- see actor-link-email-hijack.test.ts for regression
 * coverage of both the blocked attack and the preserved legitimate bootstrap.
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
): Promise<EmployeeRow | undefined> {
  let rows = await scopedRead((tx) => tx.select().from(hrmsEmployees)
    .where(and(eq(hrmsEmployees.tenantId, tenantId), eq(hrmsEmployees.userRef, actorId))));
  let emp = rows[0];

  if (!emp) {
    const email = await fetchVerifiedActorEmail(tenantId, actorId);
    if (email) {
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
  }
  return emp;
}
