/**
 * GAP-PAYROLL-TAX-DECLARATION-02: scheduler for the investment-proof retention
 * purge. Same shape as the worker's other interval jobs: a timer that finds
 * which tenants have purge-due rows (a SELECT-only platform-bypass read,
 * migration 0079) and publishes ONE purge command per tenant; the consumer
 * (consumer.ts purgeTenantProofs) does the tenant-scoped, audited work. The
 * scan is deliberately conservative (it assumes the shortest allowed
 * retention, 1 year) so a tenant with a shorter-than-default setting is never
 * missed; the consumer applies the tenant's real setting.
 */
import { sql } from "drizzle-orm";
import { pino } from "pino";
import { scopedPlatformRead } from "../../shared/db.js";
import { publishPurge } from "./commands.js";
import { MIN_RETENTION_YEARS } from "./domain.js";

const log = pino({ name: "payroll-tax-proofs-purge" });

/** Internal service-account actor id (audit actor for scheduled work). */
export const PURGE_ACTOR_ID = "00000000-0000-0000-0000-000000000099";

export async function publishDuePurges(now: Date = new Date()): Promise<number> {
  const rows = (await scopedPlatformRead((tx) => tx.execute(sql`
    SELECT DISTINCT tenant_id::text AS tenant_id FROM payroll.tax_proofs
     WHERE legal_hold = false
       AND (status = 'removed'
            OR make_date(substr(fy, 1, 4)::int + 1 + ${MIN_RETENTION_YEARS}::int, 3, 31) < (${now.toISOString()}::timestamptz AT TIME ZONE 'UTC')::date)
  `))) as unknown as Array<{ tenant_id: string }>;
  const tenants = Array.from(rows).map((r) => r.tenant_id);
  for (const tenantId of tenants) await publishPurge(tenantId, PURGE_ACTOR_ID);
  return tenants.length;
}

/** Start the daily purge tick; returns the timer so shutdown can clear it. */
export function startTaxProofPurge(intervalMs = 24 * 60 * 60_000): NodeJS.Timeout {
  const tick = (): void => {
    publishDuePurges().then(
      (n) => { if (n > 0) log.info({ tenants: n }, "tax proof purge commands published"); },
      (err) => log.warn({ err }, "tax proof purge scan failed; retried next tick"),
    );
  };
  // First run shortly after boot (lets consumers subscribe), then on the interval.
  const first = setTimeout(tick, 60_000);
  first.unref();
  const timer = setInterval(tick, intervalMs);
  timer.unref();
  return timer;
}
