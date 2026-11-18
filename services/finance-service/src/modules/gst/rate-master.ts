/**
 * Reads the effective-dated GST rate master (gl.finance_gst_rate_master, migration 0175) -- the slab validator's source of truth.
 * The master is GLOBAL (no tenant_id, no RLS), so this runs in whatever transaction the caller already holds.
 *
 * A date with NO effective slab (empty master, or a date before the first effective_from) is a hard refusal, never a silent fallback to a
 * hard-coded list: validating a rate against a guess is exactly the bug the master replaces.
 */
import { sql } from "drizzle-orm";
import { NonRetryableError } from "@civitasone/queue";

type Executor = { execute: (q: unknown) => Promise<unknown> };

/** Pure: the numeric full-slab rates from raw master rows. */
export function slabRatesOf(rows: Array<{ rate_pct: string | number }>): number[] {
  return [...new Set(rows.map((r) => Number(r.rate_pct)))].filter((n) => Number.isFinite(n)).sort((a, b) => a - b);
}

/**
 * The full-slab rates (rate_pct) in force on `onDate` (YYYY-MM-DD). With an `hsnCode`, rows scoped to a matching HSN/SAC prefix join the
 * general ('' prefix) slabs. Throws GST_RATE_MASTER_EMPTY (non-retryable) when nothing is in force.
 */
export async function slabsEffectiveOn(tx: unknown, onDate: string, hsnCode?: string | null): Promise<number[]> {
  const raw = await (tx as Executor).execute(sql`
    SELECT DISTINCT rate_pct
    FROM gl.finance_gst_rate_master
    WHERE effective_from <= ${onDate}::date
      AND (effective_to IS NULL OR effective_to >= ${onDate}::date)
      AND (hsn_prefix = '' OR (${hsnCode ?? null}::text IS NOT NULL AND ${hsnCode ?? ""}::text LIKE hsn_prefix || '%'))
  `);
  const rows = (Array.isArray(raw) ? raw : ((raw as { rows?: unknown[] } | undefined)?.rows ?? [])) as Array<{ rate_pct: string | number }>;
  const slabs = slabRatesOf(rows);
  if (slabs.length === 0) {
    throw new NonRetryableError(`GST_RATE_MASTER_EMPTY: gl.finance_gst_rate_master has no slab in force on ${onDate}; cannot validate a GST rate`);
  }
  return slabs;
}
