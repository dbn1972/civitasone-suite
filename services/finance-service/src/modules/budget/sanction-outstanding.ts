/**
 * UAT T-EDGE TE-02 (+ #2464 review): the approved sanctions still outstanding on a head for a financial year --
 * sum(amount - utilised) of approved sanctions raised in the FY (IST date). Sanctioned money is committed against the
 * head allocation: a new sanction (sanction-control.ts) and a re-appropriation or reduction of the allocation
 * (allocation-repo.ts, repo.ts, consumer.ts) must both leave room for it. Runs in the caller transaction.
 */
import { sql } from "drizzle-orm";
import { fyBounds } from "../../shared/ist-date.js";

export async function outstandingSanctionsTx(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  tx: any, tenantId: string, headId: string, fy: string, excludeSanctionId?: string,
): Promise<bigint> {
  const { start, end } = fyBounds(fy.trim());
  const exclude = excludeSanctionId ? sql`AND id <> ${excludeSanctionId}::uuid` : sql``;
  const raw = await tx.execute(sql`
    SELECT COALESCE(SUM(GREATEST(amount_minor - utilised_minor, 0)), 0)::text AS outstanding
      FROM budget.finance_sanctions
     WHERE tenant_id = ${tenantId}::uuid AND head_id = ${headId}::uuid AND status = 'approved' ${exclude}
       AND (created_at AT TIME ZONE 'Asia/Kolkata')::date BETWEEN ${start}::date AND ${end}::date
  `);
  const rows = (Array.isArray(raw) ? raw : (raw?.rows ?? [])) as Array<{ outstanding: string }>;
  return BigInt(rows[0]?.outstanding ?? "0");
}
