/**
 * GAP-PAYROLL-COSTING-02: server-side authority for "a group's active costing
 * splits must not add up to more than 100%".
 *
 * Rules are created/edited one at a time, so a group that is still being
 * built up legitimately totals LESS than 100 (the web form shows a warning);
 * what can never be valid is a total ABOVE 100, which would allocate more
 * than the group's gross. Both the write routes (fast 422) and the consumers
 * (authoritative, under an advisory lock so two concurrent saves cannot both
 * pass) use these helpers.
 */
import { sql } from "drizzle-orm";

/** split_pct is NUMERIC(5,2): compare in integer hundredths, never floats. */
export const MAX_GROUP_SPLIT_HUNDREDTHS = 10_000;

export function toHundredths(splitPct: number): number {
  return Math.round(splitPct * 100);
}

/** True when `splitPct` is within (0, 100] and has at most 2 decimals. */
export function isValidSplitPct(splitPct: number): boolean {
  if (!Number.isFinite(splitPct) || splitPct <= 0 || splitPct > 100) return false;
  return Math.abs(splitPct * 100 - Math.round(splitPct * 100)) < 1e-6;
}

type Executor = { execute: (q: ReturnType<typeof sql>) => Promise<unknown> };

/**
 * Sum (in hundredths) of the group's OTHER active rules, i.e. excluding the
 * rule being created/edited (matched by cost centre for an upsert, by id for
 * an edit).
 */
export async function otherActiveSplitHundredths(
  tx: Executor,
  tenantId: string,
  employeeGroup: string,
  exclude: { costCenterId?: string; ruleId?: string },
): Promise<number> {
  const rows = (await tx.execute(sql`
    SELECT COALESCE(SUM(ROUND(split_pct * 100)), 0)::text AS h
      FROM payroll.costing_rules
     WHERE tenant_id = ${tenantId}::uuid
       AND employee_group = ${employeeGroup}
       AND status = 'active'
       AND (${exclude.costCenterId ?? null}::uuid IS NULL OR cost_center_id <> ${exclude.costCenterId ?? null}::uuid)
       AND (${exclude.ruleId ?? null}::uuid IS NULL OR id <> ${exclude.ruleId ?? null}::uuid)
  `)) as unknown as Array<{ h: string }>;
  return Number(rows[0]?.h ?? "0");
}

/** Serialise concurrent edits of one employee group's rules (transaction-scoped). */
export async function lockCostingGroup(tx: Executor, tenantId: string, employeeGroup: string): Promise<void> {
  await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtextextended(${`costing_group:${tenantId}:${employeeGroup}`}, 0))`);
}

export function exceedsCap(otherHundredths: number, newSplitPct: number): boolean {
  return otherHundredths + toHundredths(newSplitPct) > MAX_GROUP_SPLIT_HUNDREDTHS;
}

export function formatHundredths(h: number): string {
  return `${Number((h / 100).toFixed(2))}%`;
}
