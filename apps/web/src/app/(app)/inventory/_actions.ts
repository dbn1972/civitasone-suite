"use server";

import { revalidatePath } from "next/cache";
import { getSessionRoles, INVENTORY_WRITE_ROLES, INVENTORY_SETTINGS_ROLES } from "@/lib/auth/roleGuard";

/**
 * CLOS3-S2-02: drop the server Data Cache for every /inventory view after a write.
 *
 * The inventory loaders read through fetchJson with `revalidateSeconds` 15-60, i.e. Next's
 * fetch Data Cache. `router.refresh()` only resets the CLIENT Router Cache, so a policy, bin,
 * item or ledger change stayed invisible for up to a minute on reload. A Server Action that
 * calls revalidatePath purges the Data Cache entries tagged with the route (the whole
 * /inventory tree via the "layout" type); the caller awaits it BEFORE router.refresh()/push.
 *
 * Only a role that can write inventory triggers it; anyone else is a silent no-op, so this
 * cannot be used to churn caches. It carries no data and changes no record.
 */
const ALLOWED = [...INVENTORY_WRITE_ROLES, ...INVENTORY_SETTINGS_ROLES];

export async function revalidateInventoryViews(): Promise<void> {
  const roles = getSessionRoles();
  if (!roles.some((r) => ALLOWED.includes(r))) return;
  revalidatePath("/inventory", "layout");
}
