export type AssetType = "park" | "garden" | "tree" | "playground" | "fountain";
export type AssetStatus = "active" | "under_maintenance" | "closed";

export const VALID_ASSET_TYPES: AssetType[] = ["park", "garden", "tree", "playground", "fountain"];

const STATUS_TRANSITIONS: Record<AssetStatus, AssetStatus[]> = {
  active: ["under_maintenance", "closed"],
  under_maintenance: ["active", "closed"],
  closed: ["active"],
};

export function validateAssetStatusTransition(from: AssetStatus, to: AssetStatus): string | null {
  const allowed = STATUS_TRANSITIONS[from];
  if (!allowed || !allowed.includes(to)) return `invalid transition: ${from} → ${to}`;
  return null;
}

// Pure formatter, no I/O — see complaints/domain.ts's formatComplaintNumber
// for the full rationale (identical bug, identical fix).
export function formatAssetCode(seq: number): string {
  return `PRKA-${seq}`;
}
