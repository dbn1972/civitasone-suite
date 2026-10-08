/**
 * GAP2-LOCATIONS-LANDRECORDS-PII-01 — owner_name is citizen PII (DPDP Act 2023,
 * AGENTS.md §9). The land_records read path returned it verbatim to every
 * ADMIN-role caller. We now MASK owner_name in list/detail responses by default
 * and expose an audited reveal endpoint gated on a stricter role set.
 *
 * Masking rule mirrors packages/render/src/mask.ts `maskValue`: a name of
 * length >= 4 becomes `<first2>***<last1>`; shorter names become `***`.
 */

/** Roles permitted to see the UNMASKED owner name (audited reveal). */
export const LAND_RECORD_PII_REVEAL_ROLES = ["super_admin", "location_admin"] as const;

/** Mask a single owner-name value (never returns the cleartext). */
export function maskOwnerName(name: string): string {
  if (name.length >= 4) return `${name.slice(0, 2)}***${name.slice(-1)}`;
  return "***";
}
