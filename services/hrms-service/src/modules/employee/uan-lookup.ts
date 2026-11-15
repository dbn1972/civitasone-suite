/**
 * UAN lookups through the blind index (employee.hrms_employees.uan_bidx), used by:
 *   - POST /v1/hrms/employees/by-uan (body)  (exact match, HR / payroll roles), and
 *   - the bulk-import duplicate check (bulk-import/routes.ts).
 * Both are behind HRMS_UAN_BLIND_INDEX_ENABLED. A tenant is only served from the index when EVERY employee that has a
 * UAN also has an index value ("ready"); otherwise the caller gets the legacy decrypt-and-compare result, so running
 * the flag before the backfill (scripts/backfill-uan-encryption.ts) can never hide a duplicate.
 */
import { and, eq, inArray, isNotNull, sql } from "drizzle-orm";
import { scopedRead } from "../../shared/db.js";
import { uanBlindIndexCandidates, normaliseUan } from "../../shared/blind-index.js";
import { blindIndexKeys } from "../../shared/pii-crypto.js";
import { hrmsEmployees } from "./schema.js";

type Tx = Parameters<Parameters<typeof scopedRead>[0]>[0];

const READY_TTL_MS = 30_000;
const readyUntil = new Map<string, number>();
/** Test hook: forget cached readiness. */
export function resetUanIndexReadyCache(): void { readyUntil.clear(); }

/**
 * True when every employee of the tenant that has a UAN (a non-empty one: an empty string counts as no UAN, like NULL)
 * also has an index value written under a key id that is still in the keyring. A missing index, or one under a retired
 * or unknown key id, makes the tenant "not ready" and the caller uses the legacy path. The check is an EXISTS served by
 * partial indexes (migration 0271); a positive answer is cached for 30 s per tenant (writes always store the active key,
 * so a ready tenant cannot become unready except by a key change, which needs a restart).
 */
export async function uanIndexReady(tx: Tx, tenantId: string): Promise<boolean> {
  const now = Date.now();
  if ((readyUntil.get(tenantId) ?? 0) > now) return true;
  const kids = [...blindIndexKeys().keys.keys()];
  const res = await tx.execute(sql`
    SELECT EXISTS (
      SELECT 1 FROM employee.hrms_employees
       WHERE tenant_id = ${tenantId}::uuid AND uan_number IS NOT NULL AND uan_number <> ''
         AND (uan_bidx IS NULL OR split_part(uan_bidx, '.', 1) NOT IN (${sql.join(kids.map((k) => sql`${k}`), sql`, `)}))
    ) AS not_ready`);
  const notReady = (res as unknown as Array<{ not_ready: boolean }>)[0]?.not_ready === true;
  if (!notReady) readyUntil.set(tenantId, now + READY_TTL_MS);
  return !notReady;
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
