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
