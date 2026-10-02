import type { MaintenanceSummary } from "@civitasone/types";
import { formatIndianDate, humanizeStatus } from "@/lib/formatters";

export type MaintenanceRow = {
  assetId: string;
  assetCode: string;
  assetName: string;
  maintenanceType: string;
  scheduledDate: string;
  vendor: string;
  status: string;
};

/**
 * GAP-ASSETS-MAINTENANCE-02/-03: one row per work order with columns that say what
 * they hold -- the asset's code (not a "Job" label), a humanised type
 * ("Breakdown", not the raw enum) and a formatted scheduled date. The raw status
 * goes to the status pill, which humanises and tones it itself.
 */
export function buildMaintenanceRows(records: MaintenanceSummary[]): MaintenanceRow[] {
  return records.map((r) => ({
    assetId: r.assetId,
    assetCode: r.assetCode,
    assetName: r.assetName,
    maintenanceType: humanizeStatus(r.maintenanceType),
    scheduledDate: r.scheduledDate && r.scheduledDate !== "—" ? formatIndianDate(r.scheduledDate) : "—",
    vendor: r.vendor ?? "—",
    status: r.status,
  }));
}

export function countByType(records: MaintenanceSummary[], type: MaintenanceSummary["maintenanceType"]): number {
  return records.filter((r) => r.maintenanceType === type).length;
}
