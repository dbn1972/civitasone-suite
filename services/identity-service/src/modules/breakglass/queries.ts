import { db } from "../../shared/db.js";
import * as repo from "./repo.js";
import { isInForce, type GrantView, type GrantStatus } from "./domain.js";

export async function listGrants(tenantId: string, status: string | undefined, limit: number, offset: number): Promise<GrantView[]> {
  return repo.listByTenant(tenantId, status, limit, offset);
}

export async function getGrant(tenantId: string, id: string): Promise<GrantView | null> {
  const row = await repo.findById(db as unknown as repo.Writer, tenantId, id);
  if (!row) return null;
  const view = repo.toView(row);
  // present an active-but-past-expiry grant as expired before the sweep flips it
  if (view.status === "active" && !isInForce(view.status as GrantStatus, new Date(view.expiresAt))) {
    return { ...view, status: "expired" };
  }
  return view;
}
