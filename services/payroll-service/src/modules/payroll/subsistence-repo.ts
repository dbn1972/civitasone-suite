/**
 * FR 53 suspension persistence (migration 0057): the tenant's configured
 * subsistence percentages, and the per-run record of every suspended
 * employee (the run summary's suspended list + the audit trail for the
 * amounts). Pure rule logic lives in subsistence.ts.
 */
import { sql } from "drizzle-orm";
import type { db } from "../../shared/db.js";
import { DEFAULT_SUBSISTENCE_CONFIG, type SubsistenceConfig, type SuspensionFlag } from "./subsistence.js";

type Tx = typeof db;

/** Tenant's FR 53 percentages; FR 53's own defaults when the tenant has no settings row. */
export async function resolveSubsistenceConfig(tx: Tx, tenantId: string): Promise<SubsistenceConfig> {
  const rows = (await tx.execute(sql`
    SELECT subsistence_initial_pct_bps, subsistence_review_after_days,
           subsistence_revised_min_pct_bps, subsistence_revised_max_pct_bps
      FROM payroll.payroll_settings
     WHERE tenant_id = ${tenantId}::uuid
     LIMIT 1
  `)) as unknown as Array<{
    subsistence_initial_pct_bps: number; subsistence_review_after_days: number;
    subsistence_revised_min_pct_bps: number; subsistence_revised_max_pct_bps: number;
  }>;
  const r = rows[0];
  if (!r) return DEFAULT_SUBSISTENCE_CONFIG;
  return {
    initialPctBps: BigInt(r.subsistence_initial_pct_bps),
    reviewAfterDays: Number(r.subsistence_review_after_days),
    revisedMinPctBps: BigInt(r.subsistence_revised_min_pct_bps),
    revisedMaxPctBps: BigInt(r.subsistence_revised_max_pct_bps),
  };
}

export interface RunSuspensionRow {
  tenantId: string;
  runId: string;
  employeeId: string;
  employeeNo: string;
  suspensionId: string | null;
  treatment: "subsistence" | "withheld";
  suspensionFrom: string | null;
  suspensionTo: string | null;
  daysInMonth: number;
  regularDays: number;
  subsistenceDays: number;
  initialPctBps: bigint | null;
  revisedPctBps: bigint | null;
  subsistenceMinor: bigint;
  subsistenceDaMinor: bigint;
  flags: SuspensionFlag[];
  createdBy: string;
}

/**
 * Insert-once per (tenant, run, employee). Returns true only when this call
 * inserted the row, so the caller audits exactly once even when a wedged run
 * is resumed (withheld employees have no slip, so a resume revisits them).
 */
export async function recordRunSuspension(tx: Tx, r: RunSuspensionRow): Promise<boolean> {
  const flagsArr = r.flags.length
    ? sql`ARRAY[${sql.join(r.flags.map((f) => sql`${f}`), sql`, `)}]::text[]`
    : sql`'{}'::text[]`;
  const inserted = (await tx.execute(sql`
    INSERT INTO payroll.payroll_run_suspensions (
      tenant_id, run_id, employee_id, employee_no, suspension_id, treatment,
      suspension_from, suspension_to, days_in_month, regular_days, subsistence_days,
      initial_pct_bps, revised_pct_bps, subsistence_minor, subsistence_da_minor, flags, created_by
    ) VALUES (
      ${r.tenantId}::uuid, ${r.runId}::uuid, ${r.employeeId}::uuid, ${r.employeeNo},
      ${r.suspensionId}::uuid, ${r.treatment},
      ${r.suspensionFrom}::date, ${r.suspensionTo}::date, ${r.daysInMonth}, ${r.regularDays}, ${r.subsistenceDays},
      ${r.initialPctBps == null ? null : Number(r.initialPctBps)}, ${r.revisedPctBps == null ? null : Number(r.revisedPctBps)},
      ${r.subsistenceMinor.toString()}::bigint, ${r.subsistenceDaMinor.toString()}::bigint, ${flagsArr}, ${r.createdBy}::uuid
    )
    ON CONFLICT (tenant_id, run_id, employee_id) DO NOTHING
    RETURNING id
  `)) as unknown as Array<{ id: string }>;
  return inserted.length === 1;
}

export interface RunSuspensionSummary {
  employeeId: string;
  employeeNo: string;
  treatment: "subsistence" | "withheld";
  suspensionFrom: string | null;
  suspensionTo: string | null;
  regularDays: number;
  subsistenceDays: number;
  /** Rupees, like the rest of the run-detail payload. */
  subsistenceAllowance: number;
  subsistenceDa: number;
  revisedPct: number | null;
  flags: string[];
}

export async function listRunSuspensions(tx: Tx, tenantId: string, runId: string): Promise<RunSuspensionSummary[]> {
  const rows = (await tx.execute(sql`
    SELECT employee_id::text, employee_no, treatment, suspension_from::text, suspension_to::text,
           regular_days, subsistence_days, subsistence_minor::text, subsistence_da_minor::text,
           revised_pct_bps, flags
      FROM payroll.payroll_run_suspensions
     WHERE tenant_id = ${tenantId}::uuid AND run_id = ${runId}::uuid
     ORDER BY employee_no, employee_id
  `)) as unknown as Array<{
    employee_id: string; employee_no: string; treatment: "subsistence" | "withheld";
    suspension_from: string | null; suspension_to: string | null; regular_days: number; subsistence_days: number;
    subsistence_minor: string; subsistence_da_minor: string; revised_pct_bps: number | null; flags: string[];
  }>;
  return rows.map((r) => ({
    employeeId: r.employee_id,
    employeeNo: r.employee_no,
    treatment: r.treatment,
    suspensionFrom: r.suspension_from,
    suspensionTo: r.suspension_to,
    regularDays: r.regular_days,
    subsistenceDays: r.subsistence_days,
    // Display-only rupee conversion for the run-detail payload, the same
    // convention getRunDetail uses for gross/net; the stored amount is bigint paise.
    subsistenceAllowance: Number(BigInt(r.subsistence_minor)) / 100, // precision-ok
    subsistenceDa: Number(BigInt(r.subsistence_da_minor)) / 100, // precision-ok
    revisedPct: r.revised_pct_bps == null ? null : r.revised_pct_bps / 100,
    flags: r.flags ?? [],
  }));
}
