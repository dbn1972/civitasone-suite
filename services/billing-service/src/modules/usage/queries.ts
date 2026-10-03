import { cache } from "../../shared/infra.js";
import * as repo from "./repo.js";
import { lastPeriods, meteringStatus, METERING_METRIC_KEYS } from "./domain.js";

export async function getUsage(tenantId: string, month?: string) {
  return cache.getOrLoad(cache.makeKey(tenantId, "usage", `${tenantId}:${month ?? "current"}`), () => repo.getMonthlySummary(tenantId, month));
}

/**
 * GAP-ADMIN-METERING-02: metering rows for the caller's tenant, one per billing
 * period. Amounts are integer paise as strings (never rupees, never a float);
 * the web formats them. Billing data is tenant-scoped by RLS, so this is the
 * caller's own tenant, not a cross-tenant fleet view.
 */
export async function getMetering(tenantId: string, months: number, now: Date = new Date()) {
  const periods = lastPeriods(now, months);
  const { usage, invoices } = await repo.meteringForPeriods(tenantId, periods);
  return periods.map((period) => {
    const total = (key: string) => usage.find((u) => u.periodMonth === period && u.metricKey === key)?.totalQuantity ?? 0n;
    // A period can hold several invoices (re-issued / cancelled); the newest is the one that counts.
    const inv = invoices.filter((i) => i.periodMonth === period).sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime())[0];
    return {
      tenant: tenantId,
      billingPeriod: period,
      apiCalls: total(METERING_METRIC_KEYS.apiCalls).toString(),
      storage: total(METERING_METRIC_KEYS.storage).toString(),
      users: total(METERING_METRIC_KEYS.users).toString(),
      amountMinor: (inv?.totalMinor ?? 0n).toString(),
      currency: inv?.currency ?? "INR",
      status: meteringStatus(inv?.status),
    };
  });
}
