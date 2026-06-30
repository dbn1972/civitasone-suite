import { cache } from "../../shared/infra.js";
import * as repo from "./repo.js";
import type { OperatorRow } from "./schema.js";

export type Eligibility = {
  eligible: boolean;
  canInitiate: boolean;
  divisions: string[];
  deskRoles: string[];
};

async function loadActiveDesks(tenantId: string, employeeId: string): Promise<OperatorRow[]> {
  return (
    (await cache.getOrLoad<OperatorRow[]>(
      cache.makeKey(tenantId, "operator", employeeId),
      () => repo.findActiveOperatorsForEmployee(tenantId, employeeId),
      60,
    )) ?? []
  );
}

/**
 * Is an employee an active eOffice operator? Optionally scoped to a division
 * and/or requiring initiate rights. Used to gate file movement / forward-to /
 * handover / currentWith targets.
 */
export async function checkEligibility(
  tenantId: string,
  employeeId: string,
  opts: { division?: string | undefined; requireInitiate?: boolean } = {},
): Promise<Eligibility> {
  const desks = await loadActiveDesks(tenantId, employeeId);
  const scoped = opts.division ? desks.filter((d) => d.division === opts.division) : desks;
  const canInitiate = scoped.some((d) => d.canInitiate);
  return {
    eligible: scoped.length > 0 && (opts.requireInitiate ? canInitiate : true),
    canInitiate,
    divisions: [...new Set(desks.map((d) => d.division))],
    deskRoles: [...new Set(scoped.map((d) => d.deskRole))],
  };
}

/** Convenience boolean: is this employee allowed to receive/hold a file? */
export async function isActiveOperator(
  tenantId: string,
  employeeId: string,
  division?: string,
): Promise<boolean> {
  const e = await checkEligibility(tenantId, employeeId, { division });
  return e.eligible;
}

/** Has the tenant adopted the operator model (enrolled ≥1 active operator)? Cached. */
export async function tenantHasOperators(tenantId: string): Promise<boolean> {
  return (
    (await cache.getOrLoad<boolean>(
      cache.makeKey(tenantId, "operator", "_any"),
      () => repo.hasActiveOperators(tenantId),
      60,
    )) ?? false
  );
}

/**
 * Adoption-aware gate. Returns true (allowed) when the target is an active
 * operator, OR when the tenant has not yet enrolled ANY operators (so existing
 * / greenfield file movement is not broken before the operator model is set
 * up). Returns false only when operators exist but the target isn't one.
 */
export async function isMoveAllowed(
  tenantId: string,
  employeeId: string,
  division?: string,
): Promise<boolean> {
  if (await isActiveOperator(tenantId, employeeId, division)) return true;
  return !(await tenantHasOperators(tenantId)); // allow until the tenant adopts operators
}

export async function invalidateOperatorCache(tenantId: string, employeeId: string): Promise<void> {
  await cache.invalidate(cache.makeKey(tenantId, "operator", employeeId));
  // Also bust the adoption flag so the first enrolment flips gating on.
  await cache.invalidate(cache.makeKey(tenantId, "operator", "_any"));
}

/** Classification → clearance rank (CSMOP). */
export const CLASSIFICATION_RANK: Record<string, number> = {
  public: 1, confidential: 2, secret: 3, top_secret: 4,
};

/** Highest clearance rank held by an employee across their active desks (0 if none). */
export async function clearanceRankFor(tenantId: string, employeeId: string): Promise<number> {
  const desks = await loadActiveDesks(tenantId, employeeId);
  return desks.reduce((max, d) => Math.max(max, d.clearanceLevel ?? 1), 0);
}

/**
 * CSMOP classification-based access control. Allows access when the file is
 * `public`, OR the tenant hasn't adopted operators yet (greenfield), OR the
 * actor's clearance rank >= the file's classification rank. Denies otherwise.
 */
export async function isAccessAllowed(
  tenantId: string,
  employeeId: string,
  classification: string,
): Promise<boolean> {
  const need = CLASSIFICATION_RANK[classification] ?? 1;
  if (need <= 1) return true; // public
  if (!(await tenantHasOperators(tenantId))) return true; // not yet adopted
  return (await clearanceRankFor(tenantId, employeeId)) >= need;
}
