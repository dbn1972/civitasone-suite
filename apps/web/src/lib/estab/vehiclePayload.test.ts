import { describe, it, expect } from "vitest";
import { EstabCreateVehicleBodySchema } from "@civitasone/schemas/web";
import { buildVehiclePayload, VEHICLE_FUEL_OPTIONS, FUEL_LABEL_KEY } from "./vehiclePayload";

const UUID = "88888888-cccc-4000-8000-000000000002";

describe("buildVehiclePayload (GAP-ESTAB-VEHICLES-NEW-01)", () => {
  it("Given the form values, Then the payload parses with the shared create-vehicle schema", () => {
    const payload = buildVehiclePayload({ regNo: " dl 01 ca 1234 ", makeModel: " Toyota Innova Crysta ", fuelType: "ev", allocatedTo: UUID });
    expect(EstabCreateVehicleBodySchema.parse(payload)).toEqual({
      regNo: "DL 01 CA 1234", makeModel: "Toyota Innova Crysta", fuelType: "ev", allocatedTo: UUID,
    });
  });

  it("a pool vehicle carries no allocatedTo key at all", () => {
    expect(buildVehiclePayload({ regNo: "X 1", makeModel: "A B", fuelType: "petrol", allocatedTo: null })).toEqual({
      regNo: "X 1", makeModel: "A B", fuelType: "petrol",
    });
  });

  it("an unknown fuel type or a non-UUID officer id fails the schema instead of being posted", () => {
    expect(() => buildVehiclePayload({ regNo: "X", makeModel: "Y", fuelType: "lpg", allocatedTo: null })).toThrow();
    expect(() => buildVehiclePayload({ regNo: "X", makeModel: "Y", fuelType: "diesel", allocatedTo: "not-a-uuid" })).toThrow();
  });

  it("every fuel option the form offers is accepted by the schema, and every list value has a label", () => {
    expect(VEHICLE_FUEL_OPTIONS.map((o) => o.value)).toEqual(["petrol", "diesel", "cng", "ev"]);
    for (const o of VEHICLE_FUEL_OPTIONS) {
      expect(EstabCreateVehicleBodySchema.safeParse({ regNo: "X", makeModel: "Y", fuelType: o.value }).success).toBe(true);
    }
    for (const listed of ["petrol", "diesel", "cng", "electric"]) expect(FUEL_LABEL_KEY[listed]).toBeTruthy();
  });
});
