/**
 * winback/queries.ts — Read-model handlers with Redis cache integration.
 */
import { cache } from "../../shared/infra.js";
import * as repo from "./repo.js";
import type { WinbackCadenceView, WinbackEnrollmentView } from "./schema.js";

export const CADENCE_RESOURCE = "winback_cadence";
export const ENROLLMENT_RESOURCE = "winback_enrollment";

export async function listCadences(
  tenantId: string,
  limit: number,
  offset: number,
  status?: string,
): Promise<{ rows: WinbackCadenceView[]; total: number }> {
  return cache.listOrLoad(
    tenantId,
    CADENCE_RESOURCE,
    `list:${limit}:${offset}:${status ?? "*"}`,
    () => repo.listCadences(tenantId, limit, offset, status),
  );
}

export async function getCadenceById(
  tenantId: string,
  id: string,
): Promise<WinbackCadenceView | null> {
  return cache.getOrLoad(tenantId, CADENCE_RESOURCE, id, () =>
    repo.getCadenceById(tenantId, id),
  );
}

export async function listEnrollments(
  tenantId: string,
  limit: number,
  offset: number,
  filters: { cadenceId?: string; accountId?: string; status?: string } = {},
): Promise<{ rows: WinbackEnrollmentView[]; total: number }> {
  const variant = `list:${limit}:${offset}:${filters.cadenceId ?? "*"}:${filters.accountId ?? "*"}:${filters.status ?? "*"}`;
  return cache.listOrLoad(tenantId, ENROLLMENT_RESOURCE, variant, () =>
    repo.listEnrollments(tenantId, limit, offset, filters),
  );
}

export async function getEnrollmentById(
  tenantId: string,
  id: string,
): Promise<WinbackEnrollmentView | null> {
  return cache.getOrLoad(tenantId, ENROLLMENT_RESOURCE, id, () =>
    repo.getEnrollmentById(tenantId, id),
  );
}

export async function invalidateCadences(tenantId: string): Promise<void> {
  await cache.invalidateResource(tenantId, CADENCE_RESOURCE);
}

export async function invalidateEnrollments(tenantId: string): Promise<void> {
  await cache.invalidateResource(tenantId, ENROLLMENT_RESOURCE);
}
