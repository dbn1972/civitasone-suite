/**
 * S8 G5 -- employee read-model of the active contract + project.
 *
 * The authority stays contracts.hrms_contracts (and, for allocations, G7 later). The columns on
 * employee.hrms_employees are a SNAPSHOT recomputed from it, never edited by hand: every writer calls
 * syncEmployeeContractProjection inside its own transaction, and reconcileTenantProjection repairs drift
 * (nightly + on demand). Recomputing from source (rather than applying deltas) makes every path idempotent.
 *
 * Opt-in: nothing is written unless the tenant has contract_config.employee_projection_enabled, so an
 * existing tenant's employee rows (and the payloads built from them) are untouched until it opts in.
 */
import { and, eq, inArray, ne, or, isNotNull } from "drizzle-orm";
import { hrmsContracts } from "./schema.js";
import { hrmsEmployees } from "../employee/schema.js";
import { getContractConfigTx } from "./repo.js";
import { cache } from "../../shared/infra.js";

/** Drop the cached employee row so the next profile read sees the refreshed projection. Call AFTER the tx commits. */
export async function invalidateEmployeeCache(tenantId: string, employeeId: string): Promise<void> {
  await cache.invalidate(cache.makeKey(tenantId, "employee", employeeId));
}

/** Contract statuses that mean "in force" (the scheduler moves active -> expiring -> escalated). */
export const IN_FORCE = ["active", "expiring", "escalated"] as const;

export type ContractProjection = {
  contractId: string | null;
  contractStartDate: string | null;
  contractEndDate: string | null;
  contractStatus: string | null;
  contractRenewalCount: number | null;
  primaryProjectId: string | null;
  projectCode: string | null;
  projectName: string | null;
};

export const EMPTY_PROJECTION: ContractProjection = {
  contractId: null, contractStartDate: null, contractEndDate: null, contractStatus: null,
  contractRenewalCount: null, primaryProjectId: null, projectCode: null, projectName: null,
};

type ContractLike = {
  id: string; startDate: string; endDate: string; status: string; renewalCount: number; terms: unknown;
};

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function str(v: unknown, max: number): string | null {
  if (typeof v !== "string") return null;
  const t = v.trim();
  return t ? t.slice(0, max) : null;
}

/** The optional project reference a contract carries in terms (additive; absent on every older contract). */
export function projectFromTerms(terms: unknown): { projectId: string | null; projectCode: string | null; projectName: string | null } {
  const t = (terms && typeof terms === "object" ? terms : {}) as Record<string, unknown>;
  const id = typeof t.projectId === "string" && UUID_RE.test(t.projectId) ? t.projectId.toLowerCase() : null;
  return { projectId: id, projectCode: str(t.projectCode, 32), projectName: str(t.projectName, 160) };
}

/**
 * The contract that represents the employee today: an in-force one (latest end date wins), else the most
 * recent non-draft one (so an expired / terminated / renewed record still shows its last state). Drafts
 * (a renewal not yet activated) never count. Returns null when the employee has no non-draft contract.
 */
export function pickProjectionContract<T extends ContractLike>(rows: readonly T[]): T | null {
  const byEndDesc = (a: T, b: T) =>
    a.endDate < b.endDate ? 1 : a.endDate > b.endDate ? -1 : a.startDate < b.startDate ? 1 : a.startDate > b.startDate ? -1 : 0;
  const live = rows.filter((r) => (IN_FORCE as readonly string[]).includes(r.status)).sort(byEndDesc);
  if (live.length > 0) return live[0]!;
  const past = rows.filter((r) => r.status !== "draft").sort(byEndDesc);
  return past[0] ?? null;
}

export function buildProjection(contract: ContractLike | null): ContractProjection {
  if (!contract) return { ...EMPTY_PROJECTION };
  const p = projectFromTerms(contract.terms);
  return {
    contractId: contract.id,
    contractStartDate: contract.startDate,
    contractEndDate: contract.endDate,
    contractStatus: contract.status,
    contractRenewalCount: contract.renewalCount,
    primaryProjectId: p.projectId,
    projectCode: p.projectCode,
    projectName: p.projectName,
  };
}

export function sameProjection(a: ContractProjection, b: ContractProjection): boolean {
  return (Object.keys(EMPTY_PROJECTION) as Array<keyof ContractProjection>).every((k) => a[k] === b[k]);
}

export async function isProjectionEnabled(tx: any, tenantId: string): Promise<boolean> {
  const cfg = await getContractConfigTx(tx, tenantId);
  return cfg?.employeeProjectionEnabled === true;
}

/** Recompute one employee's projection from their contracts. No-op (false) unless the tenant opted in. */
export async function syncEmployeeContractProjection(tx: any, tenantId: string, employeeId: string): Promise<boolean> {
  if (!(await isProjectionEnabled(tx, tenantId))) return false;
  const rows = await tx
    .select()
    .from(hrmsContracts)
    .where(and(eq(hrmsContracts.tenantId, tenantId), eq(hrmsContracts.employeeId, employeeId), ne(hrmsContracts.status, "draft")));
  const next = buildProjection(pickProjectionContract(rows));
  // Deliberately NOT bumping employee.version / updated_at: a projection refresh must not make a user's
  // in-flight edit of the employee record fail its optimistic-lock check.
  await tx
    .update(hrmsEmployees)
    .set(next)
    .where(and(eq(hrmsEmployees.tenantId, tenantId), eq(hrmsEmployees.id, employeeId)));
  return true;
}

export type ReconcileResult = { checked: number; drifted: number; repaired: number; repairedIds: string[] };

/**
 * Compare every employee that has (or should have) a projection against the contracts table. repair=false
 * is the consistency check (counts drift, writes nothing); repair=true fixes it. Also the backfill: the first
 * run after a tenant opts in fills every contract employee. Idempotent.
 */
export async function reconcileTenantProjection(tx: any, tenantId: string, repair: boolean): Promise<ReconcileResult> {
  const contracts = await tx
    .select()
    .from(hrmsContracts)
    .where(and(eq(hrmsContracts.tenantId, tenantId), ne(hrmsContracts.status, "draft")));
  const byEmployee = new Map<string, any[]>();
  for (const c of contracts) {
    const list = byEmployee.get(c.employeeId) ?? [];
    list.push(c);
    byEmployee.set(c.employeeId, list);
  }
  const contractEmployeeIds = [...byEmployee.keys()];
  const where = contractEmployeeIds.length > 0
    ? or(isNotNull(hrmsEmployees.contractId), inArray(hrmsEmployees.id, contractEmployeeIds))
    : isNotNull(hrmsEmployees.contractId);
  const emps = await tx.select().from(hrmsEmployees).where(and(eq(hrmsEmployees.tenantId, tenantId), where));
  let drifted = 0;
  let repaired = 0;
  const repairedIds: string[] = [];
  for (const e of emps) {
    const want = buildProjection(pickProjectionContract(byEmployee.get(e.id) ?? []));
    const have: ContractProjection = {
      contractId: e.contractId ?? null, contractStartDate: e.contractStartDate ?? null, contractEndDate: e.contractEndDate ?? null,
      contractStatus: e.contractStatus ?? null, contractRenewalCount: e.contractRenewalCount ?? null,
      primaryProjectId: e.primaryProjectId ?? null, projectCode: e.projectCode ?? null, projectName: e.projectName ?? null,
    };
    if (sameProjection(want, have)) continue;
    drifted += 1;
    if (repair) {
      await tx.update(hrmsEmployees).set(want).where(and(eq(hrmsEmployees.tenantId, tenantId), eq(hrmsEmployees.id, e.id)));
      repaired += 1;
      repairedIds.push(e.id);
    }
  }
  return { checked: emps.length, drifted, repaired, repairedIds };
}
