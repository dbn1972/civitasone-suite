import { eq, and, isNull, notInArray } from "drizzle-orm";
import { pino } from "pino";
import { scopedRead, db } from "../../shared/db.js";
import { hrmsEmployees, type EmployeeRow } from "./schema.js";
import { HttpError } from "../../shared/context.js";
import { fetchVerifiedActorEmail } from "../../shared/identity-client.js";
import { LINK_INELIGIBLE_STATUSES, findOtherHolder, lockLogin } from "./login-holder.js";

const log = pino({ name: "hrms.actor-link" });

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
  const linked = await findLinkedEmployee(tenantId, actorId);
  if (linked) return linked;

  const email = await fetchVerifiedActorEmail(tenantId, actorId);
  if (!email) return undefined;
  if (!(await autoLinkByVerifiedEmail(tenantId, actorId, email))) return undefined;
  // Re-read through the userRef path so the result (and its ambiguity check)
  // is exactly what every later request will see.
  return findLinkedEmployee(tenantId, actorId);
}

// Issue #1780: nothing in the schema enforced (tenant_id, user_ref) uniqueness
// (migration 0253 now does, once existing duplicates are cleaned), and an
// unordered rows[0] picked an ARBITRARY row when an actor was linked twice
// (duplicate onboarding / re-link / bad import) -- self-service routes then
// served another employee's data or a false 404. Fetch every match (no
// arbitrary rows[0]) and fail CLOSED on ambiguity: never guess whose record
// the caller is, so the outcome no longer depends on row order.
async function findLinkedEmployee(tenantId: string, actorId: string): Promise<EmployeeRow | undefined> {
  const rows = await scopedRead((tx) => tx.select().from(hrmsEmployees)
    .where(and(eq(hrmsEmployees.tenantId, tenantId), eq(hrmsEmployees.userRef, actorId))));
  if (rows.length > 1) {
    throw new HttpError(409, "AMBIGUOUS_EMPLOYEE_LINK",
      "Your account is linked to more than one employee record. Please contact HR.");
  }
  return rows[0];
}

/**
 * FQ14 (security review of PR #2379, findings 1-2): the verified-email
 * bootstrap link. Writes user_ref only when it is unambiguous and cannot
 * collide with another link:
 *  - candidates are this tenant's UNLINKED (user_ref IS NULL) employees with
 *    the verified email and a link-eligible status -- an exited or no_show
 *    record never receives a login, and a record already linked to some other
 *    login is never taken over;
 *  - exactly one candidate, or nothing is written (fail CLOSED: the caller
 *    gets the normal "no employee linked" outcome and HR links explicitly via
 *    PATCH /v1/hrms/employees/:id/login-link). Duplicates are logged with
 *    employee ids only, never the email;
 *  - the write takes the candidate's row lock and then the same per-login
 *    advisory lock + "no other holder" check as the HR link route
 *    (login-holder.ts), re-validating the candidate under the lock, so a
 *    concurrent HR link and auto-link of one login cannot both commit.
 * Returns true when the actor is linked afterwards (by this call or a
 * concurrent writer).
 */
async function autoLinkByVerifiedEmail(tenantId: string, actorId: string, email: string): Promise<boolean> {
  const eligible = and(
    eq(hrmsEmployees.tenantId, tenantId),
    eq(hrmsEmployees.email, email),
    isNull(hrmsEmployees.userRef),
    notInArray(hrmsEmployees.status, [...LINK_INELIGIBLE_STATUSES]),
  );
  const candidates = await scopedRead((tx) => tx.select({ id: hrmsEmployees.id }).from(hrmsEmployees)
    .where(eligible).limit(2));
  if (candidates.length !== 1) {
    if (candidates.length > 1) {
      log.warn({ tenantId, employeeIds: candidates.map((c) => c.id) },
        "verified-email auto-link skipped: more than one eligible employee shares the email; HR must link explicitly");
    }
    return false;
  }
  const empId = candidates[0]!.id;

  // Must run inside db.transaction (not a bare db.update()) so
  // wrapWithTenantGuc sets app.tenant_id for the write -- a bare call runs on
  // a pooled connection with no GUC set, and under the NOBYPASSRLS service
  // role the fail-closed RLS policy silently matches zero rows.
  return db.transaction(async (tx) => {
    const locked = await tx.select({ id: hrmsEmployees.id }).from(hrmsEmployees)
      .where(and(eq(hrmsEmployees.id, empId), eligible))
      .for("update")
      .limit(1);
    await lockLogin(tx, tenantId, actorId);
    const holder = await findOtherHolder(tx, tenantId, actorId);
    if (holder) return true; // linked meanwhile (e.g. by HR); never add a second link
    if (!locked[0]) return false; // candidate changed (linked, exited, email edited) meanwhile
    await tx.update(hrmsEmployees)
      .set({ userRef: actorId })
      .where(and(eq(hrmsEmployees.id, empId), eq(hrmsEmployees.tenantId, tenantId)));
    return true;
  });
}
