import { assetActionScope, isTerminalAsset } from "@/lib/assetLifecycle";
import { normStatus, type StatusRule } from "../statusActions";

/**
 * Asset status rules (UX-R5 / DS-3), the record-template view of lib/assetLifecycle (assetActionScope), which
 * mirrors asset-service: disposed / written off / scrapped are off the books (nothing further); a condemned or
 * lost asset is already inside the condemnation / write-off workflow, so a disposal file cannot be raised again.
 */
export const ASSET_STATUS_RULE: StatusRule = {
  terminal: ["disposed", "written_off", "scrapped"],
  awaiting: ["condemned", "lost"],
};

/** May a disposal be raised to eOffice for this asset? Only an in-service asset ("full" action scope). */
export function assetCanRaiseDisposal(status: string | null | undefined): boolean {
  const s = normStatus(status);
  return !!s && assetActionScope(s) === "full";
}

export function assetIsFinished(status: string | null | undefined): boolean {
  return isTerminalAsset(normStatus(status));
}

/** Why the disposal route is not offered, or null when it is. */
export function assetRaiseBlockedReason(status: string | null | undefined): string | null {
  const s = normStatus(status);
  if (assetCanRaiseDisposal(s)) return null;
  if (s === "condemned") return "This asset is condemned and already in the condemnation workflow.";
  if (s === "lost") return "This asset is reported lost; it is handled through the write-off workflow.";
  return `This asset is ${s.replace(/_/g, " ")}; no disposal can be raised.`;
}
