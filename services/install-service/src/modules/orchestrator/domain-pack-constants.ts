/** Mirrored DoD §13(f) pilot pack keys — keep in sync with citizen packs/domain.ts. */
export const MUNICIPAL_ONBOARDING_PACK_KEYS = [
  "pack:trade-license",
  "pack:pgr",
  "pack:water-connection",
] as const;

/** Cross-service command consumed by citizen-service packs consumer (FN-17). */
export const CITIZEN_PACK_DOMAIN_ACTIVATE = "citizen.pack.domain_activate";
