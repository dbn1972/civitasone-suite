import type { AssetDetail } from "@civitasone/types";

/**
 * GAP-ASSETS-DETAIL-05/08: one place that decides what an asset's status
 * allows and what its lifecycle timeline may claim, so the detail page, the
 * actions card and the financial-actions card cannot disagree.
 */

export type AssetStatus = AssetDetail["status"];

/** Off the books: nothing further can be done to the asset. */
export function isTerminalAsset(status: string): boolean {
  return status === "disposed" || status === "written_off";
}

/**
 * What the detail page offers for a status:
 *  - "none":     disposed / written off -- no action cards at all;
 *  - "tag-only": condemned -- the asset is awaiting auction through the
 *                condemnation workflow, so transfer / disposal / impairment /
 *                revaluation would race it; barcode tagging stays;
 *  - "full":     every other status.
 */
export type AssetActionScope = "none" | "tag-only" | "full";
export function assetActionScope(status: string): AssetActionScope {
  if (isTerminalAsset(status)) return "none";
  if (status === "condemned") return "tag-only";
  return "full";
}

export type LifecycleState = "done" | "cur" | "todo";
export type LifecycleStep = { label: string; state: LifecycleState; detail: string };

type LifecycleInput = {
  status: string;
  barcode?: string | null;
  warrantyExpiry?: string | null;
  maintenanceHistory: ReadonlyArray<{ type: string; description: string }>;
  /** Formats a YYYY-MM-DD for display (injected so this stays pure). */
  formatDate: (d: string) => string;
  purchaseDate: string;
};

/** An AMC exists only if a maintenance record says so -- a warranty is not an AMC. */
export function hasAmcRecord(history: LifecycleInput["maintenanceHistory"]): boolean {
  return history.some((h) => /\bAMC\b/i.test(h.type) || /\bAMC\b/i.test(h.description));
}

export function deriveLifecycle(a: LifecycleInput): LifecycleStep[] {
  const retired = isTerminalAsset(a.status);
  const inService = a.status === "in_use" || a.status === "active" || a.status === "maintenance" || a.status === "transferred";
  const amc = hasAmcRecord(a.maintenanceHistory);
  return [
    { label: "Acquired (GRN)", state: "done", detail: a.formatDate(a.purchaseDate) },
    // Tagged = a barcode is actually on record, not "not yet disposed".
    { label: "Tagged", state: a.barcode ? "done" : "todo", detail: "" },
    {
      label: "In use",
      state: inService ? "cur" : retired || a.status === "condemned" ? "done" : "todo",
      detail: a.status === "maintenance" ? "Under maintenance" : "",
    },
    {
      label: "AMC",
      state: amc ? "done" : "todo",
      detail: a.warrantyExpiry ? `Warranty until ${a.formatDate(a.warrantyExpiry)}` : "",
    },
    {
      label: "Disposal",
      state: retired ? "done" : a.status === "condemned" ? "cur" : "todo",
      detail: a.status === "condemned" ? "Condemned — awaiting auction" : "",
    },
  ];
}
