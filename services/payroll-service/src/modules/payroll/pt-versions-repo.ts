/**
 * GAP-PAYROLL-STATUTORY-PT-04: reads over the professional-tax slab versions.
 * Every function takes the caller's `tx` (a scopedRead / consumer transaction),
 * never the pooled `db`, so FORCE RLS sees the tenant GUC.
 */
import { sql } from "drizzle-orm";
import type { db } from "../../shared/db.js";
import type { PtSlab } from "./pt-versions-domain.js";

type Tx = typeof db;

type SlabRow = {
  state_code: string; slab_from_minor: string | number; slab_to_minor: string | number;
  pt_amount_minor: string | number; february_amount_minor: string | number | null; effective_from: string;
};

const toSlab = (r: SlabRow): PtSlab => ({
  from: BigInt(r.slab_from_minor), to: BigInt(r.slab_to_minor), amount: BigInt(r.pt_amount_minor),
  februaryAmount: r.february_amount_minor == null ? null : BigInt(r.february_amount_minor),
});

/**
 * The slab version in force on `asOf` (YYYY-MM-DD) for each state: the active
 * rows whose effective_from is the latest one on or before `asOf`. A state with
 * no version in force is absent from the Map (callers treat that as "no slabs",
 * i.e. PT 0). `stateCodes` undefined = every state of the tenant.
 */
export async function slabsInForce(tx: Tx, tenantId: string, asOf: string, stateCodes?: readonly string[]): Promise<Map<string, PtSlab[]>> {
  const result = new Map<string, PtSlab[]>();
  if (stateCodes && stateCodes.length === 0) return result;
  const stateFilter = stateCodes
    ? sql`AND t.state_code = ANY(${sql`ARRAY[${sql.join(stateCodes.map((s) => sql`${s}`), sql`, `)}]`})`
    : sql``;
  const rows = (await tx.execute(sql`
    SELECT t.state_code, t.slab_from_minor, t.slab_to_minor, t.pt_amount_minor, t.february_amount_minor,
           t.effective_from::text AS effective_from
      FROM payroll.payroll_professional_tax t
     WHERE t.tenant_id = ${tenantId}::uuid AND t.is_active = true ${stateFilter}
       AND t.effective_from = (
         SELECT MAX(x.effective_from) FROM payroll.payroll_professional_tax x
          WHERE x.tenant_id = t.tenant_id AND x.state_code = t.state_code AND x.is_active = true
            AND x.effective_from <= ${asOf}::date)
     ORDER BY t.state_code, t.slab_from_minor
  `)) as unknown as SlabRow[];
  for (const r of rows) {
    const list = result.get(r.state_code) ?? [];
    list.push(toSlab(r));
    result.set(r.state_code, list);
  }
  return result;
}

/**
 * PT already deducted per employee in the financial year before `beforeMonth`
 * (YYYY-MM), from the slips of approved / disbursed runs -- the same
 * finalised-runs-only rule the YTD TDS read uses. Drives the Article 276(2)
 * annual cap.
 */
export async function ptYtdMinors(tx: Tx, tenantId: string, employeeIds: readonly string[], fyStart: number, beforeMonth: string): Promise<Map<string, bigint>> {
  const result = new Map<string, bigint>();
  if (employeeIds.length === 0) return result;
  const rows = (await tx.execute(sql`
    SELECT s.employee_id, COALESCE(SUM((c.value ->> 'amountMinor')::bigint), 0)::text AS ytd
      FROM payroll.payroll_slips s
      JOIN payroll.payroll_runs r ON r.id = s.run_id AND r.tenant_id = s.tenant_id
      CROSS JOIN LATERAL jsonb_array_elements(s.components) AS c(value)
     WHERE s.tenant_id = ${tenantId}::uuid
       AND s.employee_id = ANY(${sql`ARRAY[${sql.join(employeeIds.map((id) => sql`${id}::uuid`), sql`, `)}]`})
       AND c.value ->> 'code' = 'PT'
       AND r.month >= ${`${fyStart}-04`} AND r.month < ${beforeMonth}
       AND r.status IN ('approved', 'disbursed')
     GROUP BY s.employee_id
  `)) as unknown as Array<{ employee_id: string; ytd: string }>;
  for (const r of rows) result.set(r.employee_id, BigInt(r.ytd));
  return result;
}

/** Month (YYYY-MM) of the tenant's latest finalised (approved / disbursed) run, or null. */
export async function latestFinalisedRunMonth(tx: Tx, tenantId: string): Promise<string | null> {
  const rows = (await tx.execute(sql`
    SELECT MAX(month) AS month FROM payroll.payroll_runs
     WHERE tenant_id = ${tenantId}::uuid AND status IN ('approved', 'disbursed')
  `)) as unknown as Array<{ month: string | null }>;
  return rows[0]?.month ?? null;
}

export type VersionSlab = { fromMinor: number; toMinor: number; taxMinor: number; februaryTaxMinor: number | null };
export type StoredVersion = {
  stateCode: string; effectiveFrom: string; legacy: boolean; reason: string | null;
  backDated: boolean; createdBy: string | null; createdAt: string | null; slabs: VersionSlab[];
};

/** Every active slab of the tenant (optionally one state) grouped into versions, oldest first per state. */
export async function listVersions(tx: Tx, tenantId: string, stateCode?: string): Promise<StoredVersion[]> {
  const stateFilter = stateCode ? sql`AND t.state_code = ${stateCode}` : sql``;
  const rows = (await tx.execute(sql`
    SELECT t.state_code, t.effective_from::text AS effective_from, t.slab_from_minor, t.slab_to_minor,
           t.pt_amount_minor, t.february_amount_minor,
           v.source, v.reason, v.back_dated, v.created_by, v.created_at
      FROM payroll.payroll_professional_tax t
      LEFT JOIN payroll.payroll_pt_slab_versions v
        ON v.tenant_id = t.tenant_id AND v.state_code = t.state_code AND v.effective_from = t.effective_from
     WHERE t.tenant_id = ${tenantId}::uuid AND t.is_active = true ${stateFilter}
     ORDER BY t.state_code, t.effective_from, t.slab_from_minor
  `)) as unknown as Array<SlabRow & { source: string | null; reason: string | null; back_dated: boolean | null; created_by: string | null; created_at: string | Date | null }>;
  const out: StoredVersion[] = [];
  for (const r of rows) {
    let v = out.find((x) => x.stateCode === r.state_code && x.effectiveFrom === r.effective_from);
    if (!v) {
      v = {
        stateCode: r.state_code, effectiveFrom: r.effective_from,
        // Slabs written before versioning (migration backfill) or inserted
        // without a header row count as the legacy baseline.
        legacy: r.source == null || r.source === "migration",
        reason: r.reason, backDated: r.back_dated === true, createdBy: r.created_by,
        createdAt: r.created_at == null ? null : new Date(r.created_at).toISOString(),
        slabs: [],
      };
      out.push(v);
    }
    v.slabs.push({
      fromMinor: Number(r.slab_from_minor), toMinor: Number(r.slab_to_minor), taxMinor: Number(r.pt_amount_minor),
      februaryTaxMinor: r.february_amount_minor == null ? null : Number(r.february_amount_minor),
    });
  }
  return out;
}

/** Flat rows of the slab version in force on `asOf` for every state (the "current slabs" read models). */
export async function inForceRows(tx: Tx, tenantId: string, asOf: string): Promise<Array<Record<string, unknown>>> {
  return (await tx.execute(sql`
    SELECT t.state_code, t.slab_from_minor, t.slab_to_minor, t.pt_amount_minor, t.february_amount_minor,
           t.effective_from::text AS effective_from
      FROM payroll.payroll_professional_tax t
     WHERE t.tenant_id = ${tenantId}::uuid AND t.is_active = true
       AND t.effective_from = (
         SELECT MAX(x.effective_from) FROM payroll.payroll_professional_tax x
          WHERE x.tenant_id = t.tenant_id AND x.state_code = t.state_code AND x.is_active = true
            AND x.effective_from <= ${asOf}::date)
     ORDER BY t.state_code, t.slab_from_minor
  `)) as unknown as Array<Record<string, unknown>>;
}
