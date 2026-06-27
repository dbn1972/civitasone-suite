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
