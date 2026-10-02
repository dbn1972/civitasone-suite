/**
 * DID-to-tenant resolution — pure domain function.
 *
 * Given an inbound calleeNumber and a list of DID mappings, resolves the
 * tenant that owns the number. Falls back to DEFAULT_TENANT_ID if no mapping
 * is found.
 *
 * The lookup normalizes the dialed number (strips spaces, dashes) before
 * comparing against stored DID numbers for a match.
 */

export interface DidMapping {
  didNumber: string;
  tenantId: string;
  active: boolean;
}

/**
 * Normalize a phone number for comparison: strip whitespace, dashes, parens.
 * Keeps the leading `+` and digits only.
 */
export function normalizeNumber(number: string): string {
  return number.replace(/[\s\-()]/g, "");
}

/**
 * Resolve a dialed number to a tenant ID using DID mappings.
 *
 * @param calleeNumber - The dialed number from the inbound call
 * @param mappings - Active DID-to-tenant mappings to search
 * @param defaultTenantId - Fallback tenant ID when no mapping found
 * @returns The resolved tenant ID
 */
export function resolveTenant(
  calleeNumber: string,
  mappings: DidMapping[],
  defaultTenantId: string,
): string {
  if (!calleeNumber) return defaultTenantId;

  const normalized = normalizeNumber(calleeNumber);

  // Collect every tenant holding an ACTIVE mapping for this number. Exactly
  // one owner resolves to that tenant. More than one is an ambiguous
  // (conflicting) assignment: it used to resolve to whichever row came first
  // in an unordered result, so a second tenant mapping someone else's number
  // could receive that number's calls. Migration 0020's unique index and the
  // command-side 409 now prevent the conflict; if one ever exists anyway, fail
  // closed to the default tenant instead of picking an arbitrary owner.
  const owners = new Set<string>();
  for (const mapping of mappings) {
    if (!mapping.active) continue;
    if (normalizeNumber(mapping.didNumber) === normalized) owners.add(mapping.tenantId);
  }
  if (owners.size === 1) return owners.values().next().value as string;
  return defaultTenantId;
}

/** Environment-sourced default tenant ID for calls with no DID mapping. */
export const DEFAULT_TENANT_ID =
  process.env.DEFAULT_TENANT_ID ?? "00000000-0000-0000-0000-000000000001";
