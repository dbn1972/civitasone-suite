/**
 * Read-only pre-checks for the payroll "adjustments" routes (flex-benefit
 * elections, off-cycle processing, reimbursement decisions) -- b3 gap batch.
 *
 * Kept out of the route handlers on purpose: gap-routes.ts / world-class-
 * routes.ts are CQRS-only (publish + 202), and their static tests
 * (tests/T1-03-gap-routes-cqrs.test.ts, tests/world-class-cqrs.test.ts) pin
 * each handler's body to "parse -> guard -> commands.* -> sendAccepted".
 * Every function here only READS (scopedRead) and throws HttpError; the
 * writes stay in the idempotent consumers.
 */
import { sql } from "drizzle-orm";
import type { RequestContext } from "@civitasone/types";
import { scopedRead } from "../../shared/db.js";
import { HttpError } from "../../shared/context.js";
import { resolveActorEmployeeId, HrmsUnavailableError } from "../../shared/hrms-client.js";

// ─── Self-service identity ──────────────────────────────────────────────────

/**
 * The caller's own hrms_employees.id. actorId (JWT subject) is a DIFFERENT
 * id space from payroll's employee_id columns (see hrms-client.ts
 * resolveActorEmployeeId and the GET /v1/payroll/slips/:id self-scope in
 * routes.ts) -- comparing the two directly is never right. Fails CLOSED:
 * an unreachable HRMS is 502, an unlinked actor is 403.
 */
export async function requireOwnEmployeeId(ctx: RequestContext): Promise<string> {
  let own: string | null;
  try {
    own = await resolveActorEmployeeId(ctx.tenantId, ctx.actorId);
  } catch (err) {
    if (err instanceof HrmsUnavailableError) {
      throw new HttpError(502, "HRMS_UNAVAILABLE", "cannot resolve caller's employee record: HRMS identity source unreachable");
    }
    throw err;
  }
  if (!own) throw new HttpError(403, "FORBIDDEN", "no employee record is linked to this user");
  return own;
}

/**
 * GAP-PAYROLL-REIMBURSEMENTS-01/05: effective employeeId for a reimbursement
 * read or write. A caller holding one of `staffRoles` (the ROUTE's own
 * privileged role list) passes the requested id through (act-on-behalf /
 * tenant-wide list). EVERY other caller is pinned to their OWN employee id
 * (403 if they name anyone else) -- deliberately not isSelfServiceEmployee(),
 * whose PRIVILEGED_PAYROLL_ROLES includes finance_officer: a
 * finance_officer+employee user would otherwise read every claim in the
 * tenant (incl. medical bill refs) on a route that does not admit
 * finance_officer at all (b3 review, HIGH).
 * Service accounts are not pinned (same as isSelfServiceEmployee).
 *
 * Replaces enforceEmployeeOwnership(ctx, ...) on these two routes: that
 * helper compares against the raw actorId, so it 403'd an employee filing
 * for themselves with their real employee id, and when it passed it stored
 * the actorId as employee_id -- a row no payroll run would ever match.
 */
export async function scopeReimbursementEmployee(
  ctx: RequestContext,
  requested: string | undefined,
  mode: "read" | "write",
  staffRoles: readonly string[],
): Promise<string | undefined> {
  const isStaff = ctx.actorType === "service_account" || staffRoles.some((r) => ctx.roles.includes(r));
  if (isStaff) {
    if (mode === "write" && !requested) throw new HttpError(400, "VALIDATION_FAILED", "employeeId is required");
    return requested;
  }
  const own = await requireOwnEmployeeId(ctx);
  if (requested && requested !== own) {
    throw new HttpError(403, "FORBIDDEN", "employees may only access their own reimbursement claims");
  }
  return own;
}

// ─── Flex benefits ──────────────────────────────────────────────────────────

export type FlexPlanComponent = { name: string; maxMinor: number; taxExempt?: boolean };

/**
 * Pure check of an election against its plan (GAP-PAYROLL-FLEX-BENEFITS-01/03).
 * Returns an error message, or null when the election fits the plan.
 */
export function electionViolation(
  plan: { fy: string; totalBudgetMinor: bigint; components: FlexPlanComponent[] },
  election: { fy: string; elections: Array<{ component: string; electedMinor: number }> },
): string | null {
  if (plan.fy.trim() !== election.fy.trim()) return `election fy ${election.fy} does not match plan fy ${plan.fy}`;
  const byName = new Map(plan.components.map((c) => [c.name, c]));
  const seen = new Set<string>();
  let total = 0n;
  for (const line of election.elections) {
    const comp = byName.get(line.component);
    if (!comp) return `component "${line.component}" is not part of this plan`;
    if (seen.has(line.component)) return `component "${line.component}" is elected more than once`;
    seen.add(line.component);
    if (BigInt(line.electedMinor) > BigInt(comp.maxMinor)) return `component "${line.component}" exceeds its plan maximum`;
    total += BigInt(line.electedMinor);
  }
  if (total > plan.totalBudgetMinor) return "total elected amount exceeds the plan budget";
  return null;
}

export async function assertElectionWithinPlan(
  ctx: RequestContext,
  body: { planId: string; fy: string; elections: Array<{ component: string; electedMinor: number }> },
): Promise<void> {
  const rows = (await scopedRead((tx) => tx.execute(sql`
    SELECT fy, total_budget_minor, components, status FROM payroll.flex_benefit_plans
    WHERE id = ${body.planId}::uuid AND tenant_id = ${ctx.tenantId}::uuid LIMIT 1
  `))) as unknown as Array<{ fy: string; total_budget_minor: string | number; components: FlexPlanComponent[] | string; status: string }>;
  const row = rows[0];
  if (!row || row.status !== "active") throw new HttpError(404, "NOT_FOUND", "flex benefit plan not found");
  const components = typeof row.components === "string" ? (JSON.parse(row.components) as FlexPlanComponent[]) : row.components;
  const violation = electionViolation(
    { fy: row.fy, totalBudgetMinor: BigInt(row.total_budget_minor), components: Array.isArray(components) ? components : [] },
    body,
  );
  if (violation) throw new HttpError(400, "VALIDATION_FAILED", violation);
}

// ─── Reimbursement decisions ────────────────────────────────────────────────

/**
 * GAP-PAYROLL-REIMBURSEMENTS-02: a claim can be approved/rejected only while
 * `submitted` (409 otherwise), never by the person who filed it, and never by
 * the claimant themselves (maker-checker, 403).
 */
export async function assertReimbursementDecidable(ctx: RequestContext, id: string): Promise<void> {
  const rows = (await scopedRead((tx) => tx.execute(sql`
    SELECT status, employee_id::text AS employee_id, created_by::text AS created_by
    FROM payroll.payroll_reimbursements
    WHERE id = ${id}::uuid AND tenant_id = ${ctx.tenantId}::uuid LIMIT 1
  `))) as unknown as Array<{ status: string; employee_id: string; created_by: string }>;
  const claim = rows[0];
  if (!claim) throw new HttpError(404, "NOT_FOUND", "reimbursement claim not found");
  if (claim.status !== "submitted") throw new HttpError(409, "INVALID_STATE", `claim is ${claim.status}, only submitted claims can be decided`);
  if (claim.created_by === ctx.actorId) {
    throw new HttpError(403, "SELF_APPROVAL_FORBIDDEN", "a claim cannot be decided by the person who filed it");
  }
  let own: string | null;
  try {
    own = await resolveActorEmployeeId(ctx.tenantId, ctx.actorId);
  } catch (err) {
    if (err instanceof HrmsUnavailableError) {
      throw new HttpError(502, "HRMS_UNAVAILABLE", "cannot verify approver identity: HRMS identity source unreachable");
    }
    throw err;
  }
  if (own && own === claim.employee_id) {
    throw new HttpError(403, "SELF_APPROVAL_FORBIDDEN", "you cannot decide your own reimbursement claim");
  }
}
