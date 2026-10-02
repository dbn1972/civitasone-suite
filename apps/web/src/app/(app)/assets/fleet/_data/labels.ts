/**
 * Pure, client-safe labels for fleet pickers and tables (GAP-ASSETS-FLEET-*).
 * A clerk chooses a vehicle/device by registration number or IMEI -- never
 * by typing its UUID.
 */
export type PickerOption = { id: string; label: string };

export type VehicleLike = { id: string; registrationNo: string; make?: string; model?: string };

export function vehicleLabel(v: VehicleLike): string {
  const makeModel = [v.make, v.model].filter((s) => s && s.trim()).join(" ");
  return makeModel ? `${v.registrationNo} — ${makeModel}` : v.registrationNo;
}

export function vehicleOptions(vehicles: readonly VehicleLike[]): PickerOption[] {
  return vehicles.map((v) => ({ id: v.id, label: vehicleLabel(v) }));
}

/**
 * GAP-ASSETS-FLEET-VEHICLES-04: fuel type is a lower-case enum on the wire
 * ("cng"); capitalising the first letter rendered "Cng". One label map for the
 * dropdown, the confirm dialog and the table.
 */
export const FUEL_TYPES = ["petrol", "diesel", "electric", "cng"] as const;
export type FuelType = (typeof FUEL_TYPES)[number];

export const FUEL_LABELS: Record<FuelType, string> = {
  petrol: "Petrol",
  diesel: "Diesel",
  electric: "Electric",
  cng: "CNG",
};

export function fuelLabel(raw: string | null | undefined): string {
  if (!raw) return "—";
  return (FUEL_LABELS as Record<string, string>)[raw.toLowerCase()] ?? raw;
}
