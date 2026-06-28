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

export async function invalidateOperatorCache(tenantId: string, employeeId: string): Promise<void> {
  await cache.invalidate(cache.makeKey(tenantId, "operator", employeeId));
}
