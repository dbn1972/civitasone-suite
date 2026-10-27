/**
 * OWNER DECISION #24 (TENANT-ADMIN-PLANS-02): pure rules for a plan downgrade
 * request. Side-effect free so every outcome is unit-testable and the route (early
 * 409) and the consumer (authoritative re-check at approval) cannot disagree.
 */
import type { UsageCheck } from "./schema.js";

export interface PlanLimits { maxUsers: number; maxStorageGb: number; priceMinor: bigint }

/**
 * The limits of the target plan that current usage exceeds. Empty = the downgrade
 * is allowed. `used` is the live quota counter; a resource with no counter is
 * treated as 0 used (nothing to block on).
 */
export function exceededLimits(usage: { users: number; storage_gb: number }, target: PlanLimits): UsageCheck[] {
  const out: UsageCheck[] = [];
  if (usage.users > target.maxUsers) out.push({ resource: "users", used: usage.users, limit: target.maxUsers });
  if (usage.storage_gb > target.maxStorageGb) out.push({ resource: "storage_gb", used: usage.storage_gb, limit: target.maxStorageGb });
  return out;
}

/** A downgrade must move to a strictly cheaper plan (money is bigint minor units). */
export function isDowngrade(current: Pick<PlanLimits, "priceMinor">, target: Pick<PlanLimits, "priceMinor">): boolean {
  return target.priceMinor < current.priceMinor;
}
