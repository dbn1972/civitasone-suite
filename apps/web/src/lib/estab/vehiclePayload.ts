import { EstabCreateVehicleBodySchema, ESTAB_VEHICLE_FUEL_TYPES, type EstabCreateVehicleBody } from "@civitasone/schemas/web";

/** Fuel options the "Add vehicle" form offers: the values estab-service accepts, label keys in estabW2. */
export const VEHICLE_FUEL_OPTIONS = ESTAB_VEHICLE_FUEL_TYPES.map((value) => ({
  value,
  labelKey: ({ petrol: "fuelPetrol", diesel: "fuelDiesel", cng: "fuelCng", ev: "fuelEv" } as const)[value],
}));

/** The list reports an electric vehicle as "electric" (it is posted and stored as "ev"). */
export const FUEL_LABEL_KEY: Record<string, string> = {
  petrol: "fuelPetrol", diesel: "fuelDiesel", cng: "fuelCng", electric: "fuelEv", ev: "fuelEv",
};

/**
 * The POST /v1/estab/vehicles payload, built and checked against the SAME schema the service uses
 * (@civitasone/schemas EstabCreateVehicleBodySchema), so a drift in the keys is a type error and a
 * failing test, not a silently rejected or blank-stored vehicle (GAP-ESTAB-VEHICLES-NEW-01).
 */
export function buildVehiclePayload(input: {
  regNo: string;
  makeModel: string;
  fuelType: string;
  allocatedTo: string | null;
}): EstabCreateVehicleBody {
  return EstabCreateVehicleBodySchema.parse({
    regNo: input.regNo.trim().toUpperCase(),
    makeModel: input.makeModel.trim(),
    fuelType: input.fuelType,
    ...(input.allocatedTo ? { allocatedTo: input.allocatedTo } : {}),
  });
}
