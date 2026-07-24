import * as repo from "./repo.js";
import { acknowledgementRollup, type AckRollup } from "./domain.js";
import type { PolicyView } from "./schema.js";

export async function listPolicies(
  tenantId: string,
  filters: { status?: string; docType?: string },
  limit: number,
  offset: number,
): Promise<PolicyView[]> {
  return repo.listByTenant(tenantId, filters, limit, offset);
}

export async function getPolicy(tenantId: string, id: string): Promise<PolicyView | null> {
  return repo.getById(tenantId, id);
}

export async function reviewDuePolicies(tenantId: string, asOf?: string): Promise<PolicyView[]> {
  const date = asOf ?? new Date().toISOString().slice(0, 10);
  return repo.reviewDue(tenantId, date);
}

/** Raw list of employees who acknowledged. */
export async function acknowledgedEmployeeIds(tenantId: string, policyId: string): Promise<string[]> {
  return repo.listAckEmployeeIds(tenantId, policyId);
}

/** Who-has / who-hasn't rollup against an expected roster. */
export async function acknowledgementReport(
  tenantId: string,
  policyId: string,
  expectedEmployeeIds: string[],
): Promise<AckRollup> {
  const acked = await repo.listAckEmployeeIds(tenantId, policyId);
  return acknowledgementRollup(expectedEmployeeIds, acked);
}
