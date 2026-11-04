/**
 * UAT b18 D2: a payroll run for a financial year with no income-tax slab
 * configuration used to be accepted (202) and then fail for every employee
 * during compute (UnconfiguredFyError from tax/engine.ts). It is now refused
 * at run creation with 422 TAX_CONFIG_MISSING.
 *
 * Both regimes must be configured for the FY (tenant override or the platform
 * default): any employee can be on either regime, and engine.ts resolves
 * exactly these rows (tenant-first, platform-default fallback). Read from
 * payroll.tax_slab_config itself -- the table the engine registry is loaded
 * from -- under the caller's tenant GUC (platform_default_read_policy makes
 * the sentinel rows visible, migration 0039).
 */
import { sql } from "drizzle-orm";
import { scopedRead } from "../../shared/db.js";
import { HttpError } from "../../shared/context.js";
import { fyStartYearForMonth, PLATFORM_DEFAULT_TENANT_ID, type Regime } from "./engine.js";

export const TAX_CONFIG_MISSING = "TAX_CONFIG_MISSING";
const REGIMES: readonly Regime[] = ["new", "old"];

/** "2027-28" for 2027. */
export function fyLabel(startYear: number): string {
  return `${startYear}-${String((startYear + 1) % 100).padStart(2, "0")}`;
}

/** Pure: the regimes with no configured row among `configured`. */
export function missingRegimes(configured: readonly string[]): Regime[] {
  return REGIMES.filter((r) => !configured.includes(r));
}

/** Throws 422 TAX_CONFIG_MISSING when the run month's FY lacks a tax slab config for either regime. */
export async function assertTaxConfigForMonth(tenantId: string, month: string): Promise<void> {
  const fy = fyStartYearForMonth(month);
  const rows = (await scopedRead((tx) => tx.execute(sql`
    SELECT DISTINCT regime FROM payroll.tax_slab_config
    WHERE fy_start_year = ${fy}
      AND tenant_id IN (${tenantId}::uuid, ${PLATFORM_DEFAULT_TENANT_ID}::uuid)
  `))) as unknown as Array<{ regime: string }>;
  const missing = missingRegimes((rows ?? []).map((r) => r.regime));
  if (missing.length > 0) {
    throw new HttpError(
      422,
      TAX_CONFIG_MISSING,
      `No income-tax slab configuration for FY ${fyLabel(fy)} (${missing.join(" and ")} regime). Configure the FY ${fyLabel(fy)} tax slabs before creating a payroll run for ${month}.`,
    );
  }
}
