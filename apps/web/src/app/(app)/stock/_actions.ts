"use server";

import { revalidatePath } from "next/cache";
import { getSessionRoles } from "@/lib/auth/roleGuard";

/**
 * GAP-STOCK-ITEMS-NEW-01: drop the server Data Cache for every /stock view after a write.
 *
 * The stock loaders read through fetchJson with `revalidateSeconds` (60 s for the item list), i.e.
 * Next's fetch Data Cache. `router.refresh()` only resets the CLIENT Router Cache, so a newly
 * created item or posted entry stayed invisible on /stock/list and /stock/ledger for up to a
 * minute. A Server Action that calls revalidatePath purges the cached entries for the whole /stock
 * tree; the caller awaits it BEFORE router.refresh()/push.
 *
 * Only a role that can write stock triggers it (the same set stock-service accepts on its write
 * routes); anyone else is a silent no-op, so it cannot be used to churn caches. It carries no data
 * and changes no record.
 */
const STOCK_WRITE_ROLES = ["stock_manager", "stock_admin", "procurement_officer", "super_admin"];

export async function revalidateStockViews(): Promise<void> {
  const roles = getSessionRoles();
  if (!roles.some((r) => STOCK_WRITE_ROLES.includes(r))) return;
  revalidatePath("/stock", "layout");
}
