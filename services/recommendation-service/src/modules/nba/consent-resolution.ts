/**
 * P2-1 — edge-side consent resolution for the NBA generate surface.
 *
 * Sits between the route and the pure ranking domain: ranking-domain.ts stays
 * IO-free and simply receives a boolean verdict, while the decision about where
 * that boolean comes from lives here, in one auditable place.
 */
import type { ActionCandidate } from "./ranking-domain.js";
import {
  fetchMarketingConsent,
  type ConsentLookup,
} from "./crm-consent-client.js";

/** True when at least one candidate is gated on marketing consent. */
export function requiresConsentResolution(
  candidates: readonly ActionCandidate[],
): boolean {
  return candidates.some((c) => c.eligibility?.requiresConsent === true);
}

/**
 * Server-verified consent verdict for a profile.
 *
 * Skips the CRM round-trip entirely when nothing in the candidate set is gated,
 * so the common NBA request keeps its read latency budget. Returning `false`
 * when skipped is safe by construction: no gated candidate can consume it.
 *
 * `lookup` is injectable so tests can substitute a fake without network.
 */
export async function resolveConsentGranted(
  candidates: readonly ActionCandidate[],
  profileId: string,
  tenantId: string,
  correlationId: string,
  lookup: ConsentLookup = fetchMarketingConsent,
): Promise<boolean> {
  if (!requiresConsentResolution(candidates)) return false;
  return (await lookup(profileId, tenantId, correlationId)) === "granted";
}
