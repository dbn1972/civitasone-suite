/**
 * UX-R5 (names, not ids): the asset location as officers read it. asset-service keeps a free-text `location`
 * and (since migration 0036) a `locationId`; a transfer writes the destination location id into `location`,
 * which is how a raw UUID reached the screen. Resolve either id against the functional-location register
 * (tenant-scoped GET /v1/asset/locations); an id that does not resolve reads as the honest unresolved label.
 */
import { isRealName, isUuid, unresolvedLabel } from "@/lib/records/labels";

export type AssetLocationRef = { label: string; linked: boolean };

/** The location id to look up, or null when the asset already carries a readable location name. */
export function assetLocationIdToResolve(asset: { location?: string | null; locationId?: string | null }): string | null {
  if (isUuid(asset.location)) return asset.location.trim();
  if (isRealName(asset.location)) return null;
  return isUuid(asset.locationId) ? asset.locationId.trim() : null;
}

export function assetLocationLabel(
  asset: { location?: string | null; locationId?: string | null },
  names: ReadonlyMap<string, string>,
): AssetLocationRef | null {
  const id = assetLocationIdToResolve(asset);
  if (id) {
    const name = names.get(id);
    return name ? { label: name, linked: true } : { label: unresolvedLabel(id), linked: false };
  }
  if (isRealName(asset.location)) return { label: asset.location.trim(), linked: Boolean(asset.locationId) };
  return null;
}
