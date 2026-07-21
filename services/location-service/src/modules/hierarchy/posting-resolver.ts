/**
 * Active-posting resolver (District Governance Platform, Wave-A EPIC-2 T2.2).
 *
 * The authoritative source for a caller's office/position/jurisdiction claims.
 * The token issuer (Keycloak protocol mapper, or the dev-login route) calls
 * `GET /v1/hierarchy/postings/active/:employeeId` at login and embeds the
 * returned `claims` in the JWT; `toRequestContext` (packages/auth) then surfaces
 * them on RequestContext, and the ABAC engine (EPIC-2) fences by them.
 */
import { and, eq } from "drizzle-orm";
import { db, scopedRead } from "../../shared/db.js";
import { offices, positions, postings } from "./org-schema.js";
import { jurisdictions } from "../jurisdiction/schema.js";

export interface ActivePosting {
  employeeId: string;
  officeId: string;
  officeType: string;
  domain: string;
  positionId: string;
  designation: string;
  magisterial: boolean;
  jurisdictionUnitIds: string[];
  jurisdictionLevels: string[];
}

/** The snake_case JWT claim fragment a token issuer embeds. */
export interface OrgClaims {
  office_id: string;
  position_id: string;
  dept_code: string;
  hierarchy_domain: string;
  jurisdiction_unit_ids: string[];
}

/**
 * Shape a resolved posting into the JWT org-claim fragment. Pure — unit-tested.
 * `dept_code` is derived from the office domain (civil/revenue/police/…); a
 * finer department code can be layered on later without changing callers.
 */
export function toOrgClaims(p: ActivePosting): OrgClaims {
  return {
    office_id: p.officeId,
    position_id: p.positionId,
    dept_code: p.domain,
    hierarchy_domain: p.domain,
    jurisdiction_unit_ids: p.jurisdictionUnitIds,
  };
}

/**
 * Resolve the employee's single active substantive/charge posting to its office,
 * position, and the territory that office covers. Returns null when the employee
 * holds no active posting (a non-office principal — the token simply carries no
 * org claims). Tenant-scoped.
 */
export async function resolveActivePosting(
  tenantId: string,
  employeeId: string,
): Promise<ActivePosting | null> {
  const rows = await scopedRead((tx) => tx
    .select({
      officeId: offices.id,
      officeType: offices.officeType,
      domain: offices.domain,
      positionId: positions.id,
      designation: positions.designation,
      magisterial: positions.magisterial,
    })
    .from(postings)
    .innerJoin(positions, eq(positions.id, postings.positionId))
    .innerJoin(offices, eq(offices.id, postings.officeId))
    .where(and(
      eq(postings.tenantId, tenantId),
      eq(postings.employeeId, employeeId),
      eq(postings.isActive, true),
    ))
    // Substantive charge wins over acting/additional if an employee holds more
    // than one active posting.
    .orderBy(postings.chargeType)
    .limit(1));

  const row = rows[0];
  if (!row) return null;

  const jur = await scopedRead((tx) => tx
    .select({ unitId: jurisdictions.unitId, level: jurisdictions.level })
    .from(jurisdictions)
    .where(and(
      eq(jurisdictions.tenantId, tenantId),
      eq(jurisdictions.officeId, row.officeId),
    )));

  return {
    employeeId,
    officeId: row.officeId,
    officeType: row.officeType,
    domain: row.domain,
    positionId: row.positionId,
    designation: row.designation,
    magisterial: row.magisterial,
    jurisdictionUnitIds: jur.map((j: { unitId: string }) => j.unitId),
    jurisdictionLevels: jur.map((j: { level: string }) => j.level),
  };
}
