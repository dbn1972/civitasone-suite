/**
 * M9: how a payroll tenant's salary reaches the books.
 *
 *   finance -- today's path, byte for byte: payroll.run.approved / .disbursed
 *              and the EFT instruction go to finance-service, which posts the
 *              journals and (finance.payment.made) marks the slips paid.
 *   export  -- for a tenant WITHOUT the Finance module: payroll posts nothing to
 *              finance. On approval and disbursement it stores the same journal
 *              lines as a downloadable CSV / Tally export, and slips are marked
 *              paid from the bank's return or confirmation file instead.
 *
 * The mode is DERIVED from whether the tenant has Finance; an explicit override
 * (payroll_settings.ledger_mode_override) wins when set. Every current tenant has
 * Finance and no override, so every current tenant resolves to "finance".
 */
import { sql } from "drizzle-orm";
import { pino } from "pino";
import { scopedRead } from "../../shared/db.js";
import { tenantHasModule } from "../../shared/tenant-modules.js";

const log = pino({ name: "payroll-ledger-mode" });

export type LedgerMode = "finance" | "export";
export const LEDGER_MODES: readonly LedgerMode[] = ["finance", "export"];
export type LedgerModeSource = "override" | "derived";

export function isLedgerMode(v: unknown): v is LedgerMode {
  return v === "finance" || v === "export";
}

/** Pure: the override when valid, else "finance" iff the tenant has Finance. */
export function effectiveLedgerMode(override: string | null | undefined, hasFinance: boolean): { mode: LedgerMode; source: LedgerModeSource } {
  if (isLedgerMode(override)) return { mode: override, source: "override" };
  return { mode: hasFinance ? "finance" : "export", source: "derived" };
}

/**
 * Run outside any transaction: it reads the settings row (RLS-scoped) and may ask admin-service.
 * A settings read that fails is treated as "no override" (and logged): the mode then follows whether the
 * tenant has Finance, which itself answers "yes" when unknown -- so a hiccup here can only ever leave a
 * tenant on today's finance path, never move one onto the export path.
 */
export async function resolveLedgerModeDetail(tenantId: string): Promise<{ mode: LedgerMode; source: LedgerModeSource; override: LedgerMode | null; hasFinance: boolean | null }> {
  let override: LedgerMode | null = null;
  try {
    const rows = (await scopedRead((tx) => tx.execute(sql`
      SELECT ledger_mode_override FROM payroll.payroll_settings WHERE tenant_id = ${tenantId}::uuid LIMIT 1
    `))) as unknown as Array<{ ledger_mode_override: string | null }> | undefined;
    const v = rows?.[0]?.ledger_mode_override;
    override = isLedgerMode(v) ? v : null;
  } catch (err) {
    log.warn({ tenantId, err: err instanceof Error ? err.message : String(err) }, "ledger mode: settings read failed, treating as no override");
  }
  // An override makes the Finance lookup unnecessary (and keeps an outage out of the path).
  const hasFinance = override ? null : await tenantHasModule(tenantId, "finance");
  const { mode, source } = effectiveLedgerMode(override, hasFinance ?? true);
  return { mode, source, override, hasFinance };
}

export async function resolveLedgerMode(tenantId: string): Promise<LedgerMode> {
  return (await resolveLedgerModeDetail(tenantId)).mode;
}
