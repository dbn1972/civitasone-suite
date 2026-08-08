/**
 * Domain Pack activation helpers (FN-17 / FN-20).
 * Pure — no DB / queue / cache.
 */

/** DoD §13(f) pilot set for municipal-in-v1: TL + PGR + Water. */
export const MUNICIPAL_ONBOARDING_PACK_KEYS = [
  "pack:trade-license",
  "pack:pgr",
  "pack:water-connection",
] as const;

export type DomainPackActivationSource = {
  domainPackKey: string;
  packKeys: unknown;
  manifest: unknown;
};

/**
 * Resolve which service packs to import when activating a Domain Pack.
 * Precedence: explicit request → manifest.pilotOrder → packKeys → municipal DoD default.
 */
export function resolveActivationPackKeys(
  pack: DomainPackActivationSource,
  requested?: string[],
): string[] {
  if (requested && requested.length > 0) {
    return uniquePackKeys(requested.map(normalizePackKey));
  }

  const fromPilot = pilotOrderToPackKeys(pack.manifest);
  if (fromPilot.length > 0) return uniquePackKeys(fromPilot);

  const stored = asStringArray(pack.packKeys).map(normalizePackKey);
  if (stored.length > 0) return uniquePackKeys(stored);

  if (pack.domainPackKey === "municipal-in-v1") {
    return [...MUNICIPAL_ONBOARDING_PACK_KEYS];
  }

  return [];
}

export function normalizePackKey(key: string): string {
  const trimmed = key.trim();
  if (!trimmed) return trimmed;
  return trimmed.startsWith("pack:") ? trimmed : `pack:${trimmed}`;
}

function pilotOrderToPackKeys(manifest: unknown): string[] {
  if (!manifest || typeof manifest !== "object") return [];
  const pilot = (manifest as { pilotOrder?: unknown }).pilotOrder;
  return asStringArray(pilot).map(normalizePackKey);
}

function asStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value.filter((v): v is string => typeof v === "string" && v.trim().length > 0);
}

function uniquePackKeys(keys: string[]): string[] {
  return Array.from(new Set(keys.filter(Boolean)));
}
