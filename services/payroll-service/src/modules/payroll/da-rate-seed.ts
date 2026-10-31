/**
 * B10 (UAT): payroll runs fail with DA_RATE_NOT_CONFIGURED for a tenant that
 * has no payroll.dearness_allowance_rates row at all (resolveDaRateBps in
 * payroll/consumer.ts fails loudly on a missing row by design), and no API
 * writes that table. This is the idempotent ops seed behind
 * `pnpm payroll:seed-uat-da-rates` (src/scripts/seed-uat-da-rates.ts).
 *
 * It writes the standard central-government DA series under the 7th CPC (the
 * table is one effective-dated series per tenant -- no pay-level column; 7th
 * CPC DA is a single percentage for every pay level, and DR for pensioners
 * reads the same series). Every row is labelled as UAT seed data in order_ref.
 *
 * Only a tenant with NO DA rows at all is seeded: a tenant that already has
 * any row has its own configuration, and mixing a seeded series into it would
 * silently change the rate some of its periods resolve to. ON CONFLICT DO
 * NOTHING keeps a concurrent / repeated run harmless.
 */
import { sql } from "drizzle-orm";
import { runWithTenant } from "@civitasone/db";
import { db } from "../../shared/db.js";
import { audit } from "./consumer.js";

export const UAT_DA_ORDER_REF = "UAT SEED DATA -- 7th CPC central DA; verify against the DoE OM before go-live";

/**
 * 7th CPC central DA (percent of basic pay), half-yearly revisions. rate_bps:
 * 5000 = 50.00%. Ends at the last revision known when this was written; a
 * later revision is added by payroll admin, not by this seed.
 */
export const STANDARD_DA_SERIES: ReadonlyArray<{ effectiveFrom: string; rateBps: number }> = [
  { effectiveFrom: "2023-01-01", rateBps: 4200 },
  { effectiveFrom: "2023-07-01", rateBps: 4600 },
  { effectiveFrom: "2024-01-01", rateBps: 5000 },
  { effectiveFrom: "2024-07-01", rateBps: 5300 },
  { effectiveFrom: "2025-01-01", rateBps: 5500 },
  { effectiveFrom: "2025-07-01", rateBps: 5800 },
];

export type DaSeedResult = {
  tenantId: string;
  dryRun: boolean;
  /** "seeded" (or "would_seed" on a dry run) / "skipped_has_rates". */
  outcome: "seeded" | "would_seed" | "skipped_has_rates";
  existingRows: number;
  inserted: string[];
};

export async function seedUatDaRates(
  tenantId: string,
  opts: { actorId: string; dryRun?: boolean },
): Promise<DaSeedResult> {
  return runWithTenant(tenantId, () => db.transaction(async (tx) => {
    const counted = (await tx.execute(sql`
      SELECT count(*)::int AS n FROM payroll.dearness_allowance_rates WHERE tenant_id = ${tenantId}::uuid
    `)) as unknown as Array<{ n: number }>;
    const n = counted[0]?.n ?? 0;
    const base = { tenantId, dryRun: !!opts.dryRun, existingRows: n };
    if (n > 0) return { ...base, outcome: "skipped_has_rates", inserted: [] };
    if (opts.dryRun) {
      return { ...base, outcome: "would_seed", inserted: STANDARD_DA_SERIES.map((r) => r.effectiveFrom) };
    }
    const inserted: string[] = [];
    for (const r of STANDARD_DA_SERIES) {
      const rows = (await tx.execute(sql`
        INSERT INTO payroll.dearness_allowance_rates (tenant_id, effective_from, rate_bps, order_ref)
        VALUES (${tenantId}::uuid, ${r.effectiveFrom}::date, ${r.rateBps}, ${UAT_DA_ORDER_REF})
        ON CONFLICT (tenant_id, effective_from) DO NOTHING
        RETURNING effective_from
      `)) as unknown as Array<unknown>;
      if (rows.length) inserted.push(r.effectiveFrom);
    }
    if (inserted.length) {
      await audit(tx, { tenantId, actorId: opts.actorId, correlationId: `seed-uat-da-rates:${tenantId}` },
        "create", "dearness_allowance_rates", tenantId, { seed: "uat_standard_da", effectiveFrom: inserted });
    }
    return { ...base, outcome: "seeded", inserted };
  }));
}
