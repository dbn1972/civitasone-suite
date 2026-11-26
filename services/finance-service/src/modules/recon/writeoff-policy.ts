/**
 * C30 / GAP-FINANCE-RECONCILIATION-01 (owner-approved 2026-11-26): write-off second approval. Pure, so the rule is unit-tested.
 *
 * A write-off whose |delta| is ABOVE the tenant's threshold is not final on one person's say-so: the first write_off action files a
 * REQUEST (the break keeps its status); a second write_off action by a DIFFERENT person holding finance_admin (or super_admin)
 * completes it. At or below the threshold the write-off is single-step as before. The threshold is per tenant
 * (recon.recon_policy.writeoff_second_approval_minor); DEFAULT_WRITEOFF_SECOND_APPROVAL_MINOR is a PLACEHOLDER until Finance sets
 * the real figure -- the owner decision named the approver (finance_admin) but not the amount.
 */
import { DomainError } from "../payments/domain.js";

/** Rs 50,000 in paise. Placeholder default; Finance must set the real per-tenant figure. */
export const DEFAULT_WRITEOFF_SECOND_APPROVAL_MINOR = 5_000_000n;
/** Who may complete (or decline) a pending write-off. */
export const WRITEOFF_SECOND_APPROVER_ROLES = ["finance_admin", "super_admin"] as const;

export type WriteOffDecision = "direct" | "request" | "approve";

const abs = (n: bigint): bigint => (n < 0n ? -n : n);

export function decideWriteOff(i: {
  deltaMinor: bigint | null;
  thresholdMinor: bigint;
  requestedBy: string | null;
  actorId: string;
  actorRoles: readonly string[];
}): WriteOffDecision {
  if (!i.requestedBy) {
    // A break with no amount (missing record, duplicate key) carries no money delta: nothing to second-approve.
    return abs(i.deltaMinor ?? 0n) > i.thresholdMinor ? "request" : "direct";
  }
  if (!i.actorRoles.some((r) => (WRITEOFF_SECOND_APPROVER_ROLES as readonly string[]).includes(r))) {
    throw new DomainError("WRITEOFF_APPROVER_ROLE_REQUIRED", "a write-off above the approval limit must be approved by a finance admin");
  }
  if (i.requestedBy === i.actorId) {
    throw new DomainError("MAKER_CHECKER_VIOLATION", "the person who requested this write-off cannot also approve it; a second approver is required");
  }
  return "approve";
}

/** Declining a pending write-off: the requester may withdraw it, a second approver may decline it. */
export function assertMayDeclineWriteOff(i: { requestedBy: string | null; actorId: string; actorRoles: readonly string[] }): void {
  if (!i.requestedBy) throw new DomainError("NO_PENDING_WRITEOFF", "there is no write-off request waiting on this exception");
  const approver = i.actorRoles.some((r) => (WRITEOFF_SECOND_APPROVER_ROLES as readonly string[]).includes(r));
  if (!approver && i.requestedBy !== i.actorId) {
    throw new DomainError("WRITEOFF_APPROVER_ROLE_REQUIRED", "only the requester or a finance admin can decline a pending write-off");
  }
}
