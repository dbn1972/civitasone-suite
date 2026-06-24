import { sql, type SQL } from "drizzle-orm";

/** Minimal executor surface — satisfied by the drizzle db or a transaction. */
type Executor = { execute: (query: SQL) => Promise<unknown> };

/**
 * Gapless, strictly-sequential voucher number generator.
 *
 * Uses an UPSERT with `SELECT ... FOR UPDATE` semantics on a per
 * (tenant, fy, series) counter row so that concurrent callers serialize and
 * never skip or reuse a number. Must be called inside a DB transaction so the
 * lock is held until the surrounding work commits.
 *
 * Returns both the raw sequence and a formatted voucher number, e.g.
 *   { seq: 42, voucherNo: "JV/2024-25/000042" }
 */
export async function nextVoucherNo(
  tx: Executor,
  tenantId: string,
  fy: string,
  series = "JV",
): Promise<{ seq: number; voucherNo: string }> {
  // Atomic increment with row lock. ON CONFLICT updates the existing locked row.
  const rows = await tx.execute(sql`
    INSERT INTO gl.finance_voucher_counter (tenant_id, fy, series, last_seq, updated_at)
    VALUES (${tenantId}, ${fy}, ${series}, 1, now())
    ON CONFLICT (tenant_id, fy, series)
    DO UPDATE SET last_seq = gl.finance_voucher_counter.last_seq + 1, updated_at = now()
    RETURNING last_seq
  `);
  const seq = Number((rows as unknown as Array<{ last_seq: string }>)[0]?.last_seq ?? 0);
  const voucherNo = `${series}/${fy}/${String(seq).padStart(6, "0")}`;
  return { seq, voucherNo };
}

/**
 * Gapless, strictly-sequential document number for ANY document type
 * (bill / challan / payment / sanction / …). Shares the same atomic per
 * (tenant, fy, series) counter as the journal voucher allocator above, so every
 * document class gets its own gap-free run within an FY. Must be called inside a
 * DB transaction so a rolled-back create does NOT consume a number — the
 * INSERT ... ON CONFLICT increment is rolled back with the surrounding tx.
 *
 * Format: "<PREFIX>/<fy>/<000042>", e.g. "BILL/2026-27/000042".
 */
export async function nextDocNo(
  tx: Executor,
  tenantId: string,
  fy: string,
  series: string,
  prefix = series,
): Promise<{ seq: number; docNo: string }> {
  const { seq } = await nextVoucherNo(tx, tenantId, fy, series);
  const docNo = `${prefix}/${fy}/${String(seq).padStart(6, "0")}`;
  return { seq, docNo };
}

/** Derive the Indian financial year (Apr–Mar) from a YYYY-MM-DD posting date. */
export function fyFromDate(postingDate: string): string {
  const [y, m] = postingDate.split("-").map(Number);
  if (!y || !m) return "0000-00";
  // April (month 4) starts the FY.
  const startYear = m >= 4 ? y : y - 1;
  const endYY = String((startYear + 1) % 100).padStart(2, "0");
  return `${startYear}-${endYY}`;
}
