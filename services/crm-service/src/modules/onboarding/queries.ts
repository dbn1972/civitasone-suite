import { cache } from "../../shared/infra.js";
import * as repo from "./repo.js";
import type { OnboardingCaseView } from "./schema.js";

export const RESOURCE = "onboarding_case";

export function keyFor(tenantId: string, id: string): string {
  return cache.makeKey(tenantId, RESOURCE, id);
}

export async function getOnboardingCase(id: string, tenantId: string): Promise<OnboardingCaseView | null> {
  return cache.getOrLoad<OnboardingCaseView>(keyFor(tenantId, id), () => repo.findById(id, tenantId));
}

export async function listOnboardingCases(
  tenantId: string,
  limit: number,
  offset: number,
  filters: repo.ListFilters = {},
): Promise<{ rows: OnboardingCaseView[]; total: number }> {
  const variant = `${limit}:${offset}:${filters.stage ?? "*"}:${filters.accountId ?? "*"}`;
  return cache.listOrLoad(
    tenantId,
    RESOURCE,
    variant,
    () => repo.listByTenant(tenantId, limit, offset, filters),
  );
}

/** Drop both the entity key and every cached list variant after a write applies. */
export async function invalidateCase(tenantId: string, id: string): Promise<void> {
  await cache.invalidate(keyFor(tenantId, id));
  await cache.invalidateResource(tenantId, RESOURCE);
}
