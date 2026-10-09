import { cache } from "../../shared/infra.js";
import * as repo from "./repo.js";
import type { AuctionRow } from "./schema.js";

export async function getAuction(id: string, tenantId: string): Promise<AuctionRow | null> {
  const row = await cache.getOrLoad<AuctionRow>(
    cache.makeKey(tenantId, "auction", id),
    () => repo.findAuctionById(id, tenantId)
  );
  // Defense-in-depth: guard against a cross-tenant cache hit.
  return row && row.tenantId === tenantId ? row : null;
}

export type ReverseAuctionSummary = {
  id: string;
  // GAP-PROCUREMENT-REVERSE-AUCTION-02: a stable human identifier + the indent
  // it serves, so the register is not identified only by free-text item label.
  auctionNo: string;
  indentRef: string;
  item: string;
  // Backward-compatible rupee fields (number) kept for existing callers.
  startPrice: number;
  currentLowest: number;
  // GAP-PROCUREMENT-REVERSE-AUCTION-03: authoritative paise values (strings, no
  // float) so the web can render exact paise via formatMoney and compute
  // BigInt savings. `savingsMinor` = reserve − lowest effective (never below 0).
  startPriceMinor: string;
  currentLowestMinor: string;
  savingsMinor: string;
  bidders: number;
  timeRemaining: string;
  // GAP-PROCUREMENT-REVERSE-AUCTION-01: real end instant (ISO) so the web can
  // run a client-side countdown instead of a static server string.
  endsAt: string;
  status: string;
};

const CLOSED_STATUSES = new Set(["closed", "awarded", "cancelled"]);

function formatTimeRemaining(remainingMs: number, status: string): string {
  if (CLOSED_STATUSES.has(status)) return "Closed";
  if (remainingMs <= 0) return "Closing";
  const hours = Math.floor(remainingMs / (60 * 60_000));
  const mins = Math.floor((remainingMs % (60 * 60_000)) / 60_000);
  return hours >= 24 ? `${Math.floor(hours / 24)}d ${hours % 24}h` : `${hours}h ${mins}m`;
}

/** GAP2-PROCUREMENT-GAPLIST-03: true total count of auctions for meta.total. */
export async function countAuctions(tenantId: string): Promise<number> {
  return repo.countAuctionsByTenant(tenantId);
}

/** Reverse-auction register (gap/routes.ts real-data lift) — no N+1: one grouped bid-stats query. */
export async function listAuctions(tenantId: string, limit: number, offset: number): Promise<ReverseAuctionSummary[]> {
  const auctions = await repo.listAuctionsByTenant(tenantId, limit, offset);
  const stats = await repo.getBidStatsByAuctionIds(tenantId, auctions.map((a) => a.id));
  const statsById = new Map(stats.map((s) => [s.auctionId, s]));
  const now = Date.now();
  return auctions.map((a) => {
    const s = statsById.get(a.id);
    const reserveMinor = BigInt(a.reserveMinor);
    const lowestMinor = s?.lowestEffectiveMinor != null ? BigInt(s.lowestEffectiveMinor) : reserveMinor;
    // Savings vs the reserve, never negative (a bid above reserve is clamped to 0
    // savings for display — the register exists to show the gain, not a loss).
    const savingsMinor = lowestMinor < reserveMinor ? reserveMinor - lowestMinor : 0n;
    return {
      id: a.id,
      auctionNo: a.auctionNo,
      indentRef: a.indentRef,
      item: a.title,
      startPrice: Number(reserveMinor) / 100,
      currentLowest: Number(lowestMinor) / 100,
      startPriceMinor: reserveMinor.toString(),
      currentLowestMinor: lowestMinor.toString(),
      savingsMinor: savingsMinor.toString(),
      bidders: s?.bidderCount ?? 0,
      timeRemaining: formatTimeRemaining(a.endAt.getTime() - now, a.status),
      endsAt: a.endAt.toISOString(),
      status: a.status,
    };
  });
}
