import { fetchJson, type LoaderResult } from "@/app/_data/apiClient";

/**
 * GET /v1/assets/fleet/vehicles (asset-service; DB-backed list via
 * listVehiclesByTenant). Shared by the vehicles, maintenance and devices
 * pages so each can label vehicles by registration number instead of UUID
 * (GAP-ASSETS-FLEET-MAINTENANCE-02, GAP-ASSETS-FLEET-VEHICLES-01).
 */
type RawRow = {
  id: string;
  registrationNo: string;
  make: string;
  model: string;
  year: number;
  fuelType: string;
  status?: string;
} & Record<string, unknown>;

export type VehicleRow = {
  id: string;
  registrationNo: string;
  make: string;
  model: string;
  year: number;
  fuelType: string;
  statusLabel: string;
};

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null;
}

export function mapVehicles(payload: unknown): VehicleRow[] | null {
  const rows = Array.isArray(payload)
    ? payload
    : isRecord(payload) && Array.isArray((payload as { data?: unknown }).data)
      ? ((payload as { data: unknown[] }).data)
      : null;
  if (!rows) return null;

  const mapped: VehicleRow[] = [];
  for (const raw of rows) {
    if (!isRecord(raw)) continue;
    const row = raw as RawRow;
    if (typeof row.id !== "string" || typeof row.registrationNo !== "string") continue;
    mapped.push({
      id: row.id,
      registrationNo: row.registrationNo,
      make: String(row.make ?? ""),
      model: String(row.model ?? ""),
      year: typeof row.year === "number" ? row.year : Number(row.year ?? 0),
      fuelType: String(row.fuelType ?? ""),
      statusLabel: String(row.status ?? "active"),
    });
  }
  return mapped;
}

export async function getVehicles(): Promise<LoaderResult<VehicleRow[]>> {
  return fetchJson<unknown, VehicleRow[]>("/api/v1/assets/fleet/vehicles?limit=200", [], {
    telemetryKey: "assets.fleet.vehicles",
    mapResponse: mapVehicles,
  });
}
