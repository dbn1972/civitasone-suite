import { cache } from "../../shared/infra.js";
import * as repo from "./repo.js";
import type { BankRow } from "./schema.js";

export async function getBankBalance(id: string, tenantId: string): Promise<BankRow | null> {
  const row = await cache.getOrLoad<BankRow>(
    cache.makeKey(tenantId, "bank", id),
    () => repo.findBankById(id)
  );
  if (!row || row.tenantId !== tenantId) return null;
  return row;
}

export type DepositsSummary = {
  total: number;
  active: number;
  refunded: number;
  forfeited: number;
  /** Bigint-safe paise string: SUM of balance_minor over ACTIVE deposits. */
  activeBalanceMinor: string;
};

/**
 * GAP2-FINANCE-TREASURY-DEPOSITS-TOTALS-06: tenant-wide deposit totals for the
 * register stat cards, aggregated in the DB so the counts and the active
 * balance money total are never derived from a capped page. Mirrors the web's
 * depositStats semantics (active balance = SUM over active-status deposits).
 */
export async function getDepositsSummary(tenantId: string): Promise<DepositsSummary> {
  const rows = await repo.getDepositStatusAggregates(tenantId);
  const s: DepositsSummary = { total: 0, active: 0, refunded: 0, forfeited: 0, activeBalanceMinor: "0" };
  let activeBalance = 0n;
  for (const r of rows) {
    s.total += r.n;
    if (r.status === "active") { s.active += r.n; activeBalance += r.balanceMinor; }
    else if (r.status === "refunded") { s.refunded += r.n; }
    else if (r.status === "forfeited") { s.forfeited += r.n; }
  }
  s.activeBalanceMinor = activeBalance.toString();
  return s;
}
