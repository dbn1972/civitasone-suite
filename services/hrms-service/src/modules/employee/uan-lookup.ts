/**
 * UAN lookups through the blind index (employee.hrms_employees.uan_bidx), used by:
 *   - GET /v1/hrms/employees/by-uan  (exact match, HR / payroll roles), and
 *   - the bulk-import duplicate check (bulk-import/routes.ts).
 * Both are behind HRMS_UAN_BLIND_INDEX_ENABLED. A tenant is only served from the index when EVERY employee that has a
 * UAN also has an index value ("ready"); otherwise the caller gets the legacy decrypt-and-compare result, so running
 * the flag before the backfill (scripts/backfill-uan-encryption.ts) can never hide a duplicate.
 */
import { and, eq, inArray, isNotNull, isNull } from "drizzle-orm";
import { scopedRead } from "../../shared/db.js";
import { uanBlindIndexCandidates, normaliseUan } from "../../shared/blind-index.js";
import { hrmsEmployees } from "./schema.js";

type Tx = Parameters<Parameters<typeof scopedRead>[0]>[0];

/** True when no employee of the tenant has a UAN without an index value. */
export async function uanIndexReady(tx: Tx, tenantId: string): Promise<boolean> {
  const rows = await tx.select({ id: hrmsEmployees.id }).from(hrmsEmployees)
    .where(and(eq(hrmsEmployees.tenantId, tenantId), isNotNull(hrmsEmployees.uanNumber), isNull(hrmsEmployees.uanBidx)))
    .limit(1);
  return rows.length === 0;
}

export interface UanMatch { id: string; employeeNo: string; fullName: string; status: string }

/**
 * Employees of the tenant holding exactly this UAN. `via` says which path answered, for tests and ops
 * (never the value).
 */
export async function findEmployeesByUan(tenantId: string, uan: string): Promise<{ via: "index" | "scan"; matches: UanMatch[] }> {
  const want = normaliseUan(uan);
  if (!want) return { via: "index", matches: [] };
  return scopedRead(async (tx) => {
    if (await uanIndexReady(tx, tenantId)) {
      const candidates = uanBlindIndexCandidates(tenantId, want);
      const rows = await tx.select({ id: hrmsEmployees.id, employeeNo: hrmsEmployees.employeeNo, fullName: hrmsEmployees.fullName, status: hrmsEmployees.status })
        .from(hrmsEmployees).where(and(eq(hrmsEmployees.tenantId, tenantId), inArray(hrmsEmployees.uanBidx, candidates)));
      return { via: "index" as const, matches: rows };
    }
    // Not fully backfilled: legacy behaviour (decrypt in the column type, compare in memory).
    const rows = await tx.select({ id: hrmsEmployees.id, employeeNo: hrmsEmployees.employeeNo, fullName: hrmsEmployees.fullName, status: hrmsEmployees.status, uan: hrmsEmployees.uanNumber })
      .from(hrmsEmployees).where(and(eq(hrmsEmployees.tenantId, tenantId), isNotNull(hrmsEmployees.uanNumber)));
    return { via: "scan" as const, matches: rows.filter((r) => normaliseUan(r.uan) === want).map(({ uan: _u, ...m }) => m) };
  });
}

/**
 * Which of these UANs already belong to an employee of the tenant (the bulk-import duplicate check). Returns the
 * subset of `uans` that matched, or null when the tenant is not ready and the caller must use the legacy path.
 */
export async function existingUans(tenantId: string, uans: readonly string[]): Promise<Set<string> | null> {
  return scopedRead(async (tx) => {
    if (!(await uanIndexReady(tx, tenantId))) return null;
    const byIndex = new Map<string, string>();
    for (const u of new Set(uans.map((x) => normaliseUan(x)).filter((x): x is string => x !== null))) {
      for (const c of uanBlindIndexCandidates(tenantId, u)) byIndex.set(c, u);
    }
    if (byIndex.size === 0) return new Set<string>();
    const found = new Set<string>();
    const idx = [...byIndex.keys()];
    for (let i = 0; i < idx.length; i += 500) {
      const rows = await tx.select({ b: hrmsEmployees.uanBidx }).from(hrmsEmployees)
        .where(and(eq(hrmsEmployees.tenantId, tenantId), inArray(hrmsEmployees.uanBidx, idx.slice(i, i + 500))));
      for (const r of rows) { const u = r.b ? byIndex.get(r.b) : undefined; if (u) found.add(u); }
    }
    return found;
  });
}
