import { fetchJson, type LoaderResult } from "@/app/_data/apiClient";

/**
 * GAP-ASSETS-FLEET-01: summary counts from GET /v1/assets/fleet/dashboard
 * (asset-service getFleetDashboard -- one DB-backed summary call). A failed
 * load renders "—", never 0, so a transient error cannot read as an empty fleet.
 * There is no device last-seen/offline signal in the service, so no
 * offline-device badge is shown.
 */
export type FleetSummary = {
  totalVehicles: number;
  availableVehicles: number;
  scheduledMaintenance: number;
  overdueMaintenance: number;
};

const EMPTY_SUMMARY: FleetSummary = { totalVehicles: 0, availableVehicles: 0, scheduledMaintenance: 0, overdueMaintenance: 0 };

function num(v: unknown): number | null {
  return typeof v === "number" && Number.isFinite(v) ? v : null;
}

export function mapFleetSummary(payload: unknown): FleetSummary | null {
  const d = typeof payload === "object" && payload !== null ? (payload as { data?: unknown }).data : null;
  if (typeof d !== "object" || d === null) return null;
  const r = d as Record<string, unknown>;
  const totalVehicles = num(r.totalVehicles);
  const availableVehicles = num(r.availableVehicles);
  const scheduledMaintenance = num(r.scheduledMaintenance);
  const overdueMaintenance = num(r.overdueMaintenance);
  if (totalVehicles === null || availableVehicles === null || scheduledMaintenance === null || overdueMaintenance === null) return null;
  return { totalVehicles, availableVehicles, scheduledMaintenance, overdueMaintenance };
}

export async function getFleetSummary(): Promise<LoaderResult<FleetSummary>> {
  return fetchJson<unknown, FleetSummary>("/api/v1/assets/fleet/dashboard", EMPTY_SUMMARY, {
    telemetryKey: "assets.fleet.dashboard",
    mapResponse: mapFleetSummary,
  });
}

