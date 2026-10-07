import { humanizeStatus } from "@/lib/formatters";

// Lives outside page.tsx: a Next.js page module may only export the page and
// route-config fields, so this mapper cannot be exported from there.
type RawRow = {
  id: string;
  registrationNo: string;
  make?: string;
  model?: string;
  year?: number;
  fuelType?: string;
  status?: string;
  assignedDriverId?: string | null;
  odometerKm?: number | null;
} & Record<string, unknown>;

export type VehicleRow = {
  id: string;
  registrationNo: string;
  makeModel: string;
  year: number | null;
  fuelType: string;
  status: string;
  statusLabel: string;
  odometer: string;
  driver: string;
};

export const STATUS_LABELS: Record<string, string> = {
  active:         "Active",
  in_maintenance: "In Maintenance",
  decommissioned: "Decommissioned",
};

// GAP-FLEET-VEHICLES-04: fuel type is a lower-case enum on the wire ("diesel",
// "cng"). humanizeStatus turns it into a display label ("Diesel", "CNG" via its
// acronym table), instead of printing the raw enum.
const FUEL_LABELS: Record<string, string> = {
  petrol: "Petrol",
  diesel: "Diesel",
  electric: "Electric",
  cng: "CNG",
};
function fuelLabel(raw: string | null | undefined): string {
  if (!raw) return "—";
  return FUEL_LABELS[raw.toLowerCase()] ?? humanizeStatus(raw);
}

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null;
}

export function mapVehicles(payload: unknown): VehicleRow[] | null {
  const rows = Array.isArray(payload)
    ? payload
    : isRecord(payload) && Array.isArray((payload as { data?: unknown }).data)
      ? (payload as { data: unknown[] }).data
      : null;
  if (!rows) return null;

  return rows.flatMap((raw) => {
    if (!isRecord(raw)) return [];
    const row = raw as RawRow;
    if (typeof row.id !== "string" || typeof row.registrationNo !== "string") return [];
    // GAP-FLEET-VEHICLES-02: do NOT default a missing status to "active". A
    // null/omitted status is unknown, not serviceable -- defaulting it to
    // "active" could show a decommissioned vehicle (whose status the API
    // omitted) as roadworthy. Show "Unknown" with a neutral pill instead.
    const rawStatus = typeof row.status === "string" && row.status.trim() ? row.status : "unknown";
    const statusLabel = STATUS_LABELS[rawStatus] ?? humanizeStatus(rawStatus);
    // GAP-FLEET-VEHICLES-03: odometer is fetched but was never shown; surface
    // it with en-IN grouping. The vehicles API returns no driver NAME and this
    // page has no roster lookup, so an assigned vehicle shows a short id tag
    // rather than inventing a name (keeps the log honest about who is resolvable).
    const odometer =
      typeof row.odometerKm === "number" && Number.isFinite(row.odometerKm)
        ? `${row.odometerKm.toLocaleString("en-IN")} km`
        : "—";
    const driver = row.assignedDriverId
      ? `Assigned (${String(row.assignedDriverId).slice(0, 8)})`
      : "Unassigned";
    return [{
      id: row.id,
      registrationNo: row.registrationNo,
      makeModel: [row.make, row.model].filter(Boolean).join(" ") || "—",
      // GAP-FLEET-VEHICLES-05: keep year as a number so the column sorts
      // numerically (align right), not as a string.
      year: typeof row.year === "number" && Number.isFinite(row.year) ? row.year : null,
      fuelType: fuelLabel(row.fuelType),
      status: rawStatus,
      statusLabel,
      odometer,
      driver,
    }];
  });
}
