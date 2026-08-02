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
  item: string;
  startPrice: number;
  currentLowest: number;
  bidders: number;
  timeRemaining: string;
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

/** Reverse-auction register (gap/routes.ts real-data lift) — no N+1: one grouped bid-stats query. */
export async function listAuctions(tenantId: string, limit: number, offset: number): Promise<ReverseAuctionSummary[]> {
  const auctions = await repo.listAuctionsByTenant(tenantId, limit, offset);
  const stats = await repo.getBidStatsByAuctionIds(tenantId, auctions.map((a) => a.id));
  const statsById = new Map(stats.map((s) => [s.auctionId, s]));
  const now = Date.now();
  return auctions.map((a) => {
    const s = statsById.get(a.id);
    const startPrice = Number(a.reserveMinor) / 100;
    return {
      id: a.id,
      item: a.title,
      startPrice,
      currentLowest: s?.lowestEffectiveMinor != null ? Number(s.lowestEffectiveMinor) / 100 : startPrice,
      bidders: s?.bidderCount ?? 0,
      timeRemaining: formatTimeRemaining(a.endAt.getTime() - now, a.status),
      status: a.status,
    };
  });
}
