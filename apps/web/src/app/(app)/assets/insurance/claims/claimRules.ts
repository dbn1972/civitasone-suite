import { parseRupeesToPaise } from "@/lib/money";

/**
 * GAP-ASSETS-INSURANCE-CLAIMS-03 / DETAIL-02: who may decide a claim and what
 * a valid settlement is. Mirrors asset-service (PATCH claims/:id/settle|reject
 * require asset_admin or super_admin; the service re-checks everything -- this
 * only keeps the controls honest and saves a round-trip).
 */
/** Shown instead of a raw UUID when a claim's policy is not among the policies fetched for the claims list. */
export const POLICY_FALLBACK_LABEL = "Policy unavailable";

export const CLAIM_DECISION_ROLES = ["asset_admin", "super_admin"];

/** A claim can still be decided while it is waiting or approved-but-unpaid. */
export function isDecidable(status: string): boolean {
  const s = status.toLowerCase();
  return s === "pending" || s === "approved";
}

export function canDecideClaims(roles: readonly string[]): boolean {
  return roles.some((r) => CLAIM_DECISION_ROLES.includes(r));
}

export type SettlementCheck = { ok: true; minor: string } | { ok: false; error: string };

/** Rupees typed by the clerk -> exact paise string, capped at the claim amount. */
export function checkSettlement(input: string, claimAmountMinor: string): SettlementCheck {
  const minor = parseRupeesToPaise(input);
  if (!minor) return { ok: false, error: "Enter a valid settled amount in rupees (e.g. 7500 or 7500.50)." };
  if (BigInt(minor) > BigInt(claimAmountMinor)) {
    return { ok: false, error: "The settled amount cannot be more than the claim amount." };
  }
  if (!Number.isSafeInteger(Number(minor))) return { ok: false, error: "That amount is too large to submit." };
  return { ok: true, minor };
}
